declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export interface TextItem {
    str: string;
    hasEOL?: boolean;
  }
  export interface TextContent {
    items: TextItem[];
  }
  export interface PDFPageProxy {
    getTextContent(): Promise<TextContent>;
  }
  export interface PDFDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PDFPageProxy>;
    destroy(): Promise<void>;
  }
  export interface PDFDocumentLoadingTask {
    promise: Promise<PDFDocumentProxy>;
  }
  export function getDocument(params: {
    data: Uint8Array;
    useSystemFonts?: boolean;
    isEvalSupported?: boolean;
    disableFontFace?: boolean;
    verbosity?: number;
  }): PDFDocumentLoadingTask;
  export const VerbosityLevel: { ERRORS: number; WARNINGS: number; INFOS: number };
}
