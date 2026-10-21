import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from 'pdf-lib';
import type { TemplateFieldInfo } from '../types.js';

export class TemplateError extends Error {}

/**
 * Read the AcroForm field catalog of a fillable PDF template.
 * Throws a TemplateError when the PDF has no usable form fields.
 */
export async function inspectTemplate(bytes: Uint8Array): Promise<TemplateFieldInfo[]> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch (err) {
    throw new TemplateError(`The template is not a readable PDF file: ${(err as Error).message}`);
  }

  const pages = doc.getPages();
  const pageIndexByRef = new Map<string, number>();
  pages.forEach((page, i) => pageIndexByRef.set(page.ref.toString(), i));

  const form = doc.getForm();
  const fields = form.getFields();
  const catalog: TemplateFieldInfo[] = [];

  for (const field of fields) {
    const name = field.getName();
    let page: number | undefined;
    try {
      const widgets = field.acroField.getWidgets();
      const ref = widgets[0]?.P()?.toString();
      if (ref !== undefined && pageIndexByRef.has(ref)) page = pageIndexByRef.get(ref)! + 1;
    } catch {
      page = undefined;
    }

    if (field instanceof PDFTextField) {
      catalog.push({
        name,
        type: 'text',
        multiline: field.isMultiline(),
        maxLength: field.getMaxLength() ?? undefined,
        page,
      });
    } else if (field instanceof PDFCheckBox) {
      catalog.push({ name, type: 'checkbox', page });
    } else if (field instanceof PDFRadioGroup) {
      catalog.push({ name, type: 'radio', options: field.getOptions(), page });
    } else if (field instanceof PDFDropdown) {
      catalog.push({ name, type: 'dropdown', options: field.getOptions(), page });
    } else if (field instanceof PDFOptionList) {
      catalog.push({ name, type: 'optionlist', options: field.getOptions(), page });
    }
    // Buttons and signature fields are ignored on purpose: they are not data fields.
  }

  if (catalog.length === 0) {
    throw new TemplateError(
      'The uploaded template contains no fillable AcroForm fields (PDFs exported from Word are flat). ' +
        'Upload the original Word (.docx) template instead — it is converted to a fillable PDF automatically — ' +
        'or upload a fillable PDF, or use the built-in Form §680 template.',
    );
  }
  return catalog;
}
