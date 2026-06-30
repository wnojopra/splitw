export const SUPPORTED_CURRENCIES = [
  { code: 'EUR', symbol: '€', label: 'EUR (€)' },
  { code: 'GBP', symbol: '£', label: 'GBP (£)' },
  { code: 'USD', symbol: '$', label: 'USD ($)' }
];

// Fallback rates relative to USD (1 USD = X units of currency)
// As of mid-2026 approximate rates
export const FALLBACK_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79
};

const RATES_CACHE_KEY = 'splitw_exchange_rates';
const RATES_CACHE_TIME_KEY = 'splitw_exchange_rates_timestamp';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export interface ExchangeRates {
  rates: Record<string, number>;
  timestamp: number;
}

/**
 * Fetches the latest exchange rates from a public API, falling back to cached or hardcoded rates.
 * Base currency is USD.
 */
export async function fetchExchangeRates(): Promise<Record<string, number>> {
  // Check cache first
  try {
    const cachedRatesStr = localStorage.getItem(RATES_CACHE_KEY);
    const cachedTimeStr = localStorage.getItem(RATES_CACHE_TIME_KEY);
    
    if (cachedRatesStr && cachedTimeStr) {
      const cachedTime = parseInt(cachedTimeStr, 10);
      if (Date.now() - cachedTime < CACHE_DURATION) {
        const rates = JSON.parse(cachedRatesStr);
        // Ensure all supported currencies are present
        if (rates.USD && rates.EUR && rates.GBP) {
          return rates;
        }
      }
    }
  } catch (e) {
    console.warn('Failed to read exchange rates from cache:', e);
  }

  // Try to fetch fresh rates
  try {
    // We use open.er-api.com which is free, requires no key, and supports CORS
    const response = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    if (data && data.result === 'success' && data.rates) {
      const rates: Record<string, number> = {
        USD: 1.0,
        EUR: data.rates.EUR || FALLBACK_RATES.EUR,
        GBP: data.rates.GBP || FALLBACK_RATES.GBP
      };
      
      // Save to cache
      localStorage.setItem(RATES_CACHE_KEY, JSON.stringify(rates));
      localStorage.setItem(RATES_CACHE_TIME_KEY, Date.now().toString());
      
      return rates;
    }
  } catch (e) {
    console.warn('Failed to fetch live exchange rates, using fallback:', e);
  }

  // Fallback to cached rates even if expired
  try {
    const cachedRatesStr = localStorage.getItem(RATES_CACHE_KEY);
    if (cachedRatesStr) {
      return JSON.parse(cachedRatesStr);
    }
  } catch (e) {}

  // Ultimate fallback
  return FALLBACK_RATES;
}

/**
 * Converts an amount from one currency to another using the provided rates.
 */
export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  rates?: Record<string, number>
): number {
  const fromCode = from.toUpperCase();
  const toCode = to.toUpperCase();
  
  if (fromCode === toCode) return amount;
  
  const fromRate = rates?.[fromCode] || FALLBACK_RATES[fromCode] || 1.0;
  const toRate = rates?.[toCode] || FALLBACK_RATES[toCode] || 1.0;
  
  // Convert from -> USD -> to
  const amountInUsd = amount / fromRate;
  return amountInUsd * toRate;
}
