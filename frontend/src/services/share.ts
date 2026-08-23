export function getGroupInviteUrl(groupId: string): string {
  return `${window.location.origin}/?join=${encodeURIComponent(groupId)}`;
}

export async function copyGroupInviteLink(groupId: string): Promise<boolean> {
  const inviteUrl = getGroupInviteUrl(groupId);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(inviteUrl);
      return true;
    }
    // Fallback for legacy environments
    const textarea = document.createElement('textarea');
    textarea.value = inviteUrl;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);
    return successful;
  } catch (err) {
    console.error('Failed to copy group link to clipboard:', err);
    return false;
  }
}
