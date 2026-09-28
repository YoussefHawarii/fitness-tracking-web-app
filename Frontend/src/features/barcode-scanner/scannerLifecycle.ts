export type ScanStatus =
  | 'idle'
  | 'looking-up'
  | 'found'
  | 'identified-no-nutrition'
  | 'not-loggable'
  | 'not-found'
  | 'invalid'
  | 'unavailable'
  | 'scanner-failed';

export function shouldMountBarcodeScanner(
  scanStatus: ScanStatus,
  showAddProduct: boolean,
): boolean {
  return (
    !showAddProduct &&
    scanStatus !== 'not-found' &&
    scanStatus !== 'not-loggable' &&
    scanStatus !== 'identified-no-nutrition' &&
    scanStatus !== 'invalid' &&
    scanStatus !== 'unavailable' &&
    scanStatus !== 'scanner-failed'
  );
}
