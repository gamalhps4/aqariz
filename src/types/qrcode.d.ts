/**
 * The one part of the `qrcode` package the invoice PDFs use: its core, which
 * turns text into the QR symbol's modules. Imported by path so neither the
 * browser nor the server bundle pulls in its PNG and file writers.
 */
declare module "qrcode/lib/core/qrcode" {
  export interface QRCodeBitMatrix {
    /** Modules per side. */
    size: number;
    /** Row-major, 1 for a dark module. */
    data: Uint8Array;
    get(row: number, col: number): number;
  }

  export interface QRCodeSymbol {
    modules: QRCodeBitMatrix;
    version: number;
  }

  export function create(
    text: string,
    options?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H"; version?: number },
  ): QRCodeSymbol;
}
