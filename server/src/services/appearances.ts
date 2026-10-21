/**
 * Transparent widget appearances for faithful (exact-layout) templates.
 *
 * pdf-lib's default checkbox/radio appearance providers always paint a white
 * background box plus a border outline. On faithful templates the printed
 * page itself already shows the checkbox glyph, so those painted boxes cover
 * the glyph and clip the first letter of the adjacent label. These providers
 * emit ONLY the check mark / radio dot when a widget is on, and a completely
 * empty appearance stream when it is off, so the printed page shows through.
 */
import {
  drawCheckMark,
  drawEllipse,
  pushGraphicsState,
  popGraphicsState,
  rgb,
  PDFCheckBox,
  PDFRadioGroup,
  PDFTextField,
  PDFDropdown,
  PDFOptionList,
  PDFName,
  PDFString,
  PDFDict,
  type PDFForm,
  type PDFFont,
  type AppearanceProviderFor,
} from 'pdf-lib';

const black = rgb(0, 0, 0);

export const transparentCheckBoxProvider: AppearanceProviderFor<PDFCheckBox> = (_checkBox, widget) => {
  const { width, height } = widget.getRectangle();
  const on = [
    pushGraphicsState(),
    ...drawCheckMark({
      x: width / 2,
      y: height / 2,
      size: Math.min(width, height) / 2,
      thickness: 1.5,
      color: black,
    }),
    popGraphicsState(),
  ];
  return { normal: { on, off: [] }, down: { on, off: [] } };
};

export const transparentRadioGroupProvider: AppearanceProviderFor<PDFRadioGroup> = (_radioGroup, widget) => {
  const { width, height } = widget.getRectangle();
  const dotScale = (Math.min(width, height) / 2) * 0.45;
  const on = [
    pushGraphicsState(),
    ...drawEllipse({
      x: width / 2,
      y: height / 2,
      xScale: dotScale,
      yScale: dotScale,
      color: black,
      borderColor: undefined,
      borderWidth: 0,
    }),
    popGraphicsState(),
  ];
  return { normal: { on, off: [] }, down: { on, off: [] } };
};

const MK = PDFName.of('MK');

/** Staff signature fields get a handwriting-style font; the date field does not. */
export function isSignatureField(name: string): boolean {
  return /signature/i.test(name) && !/date/i.test(name);
}

/** Register a font in the AcroForm /DR so /DA strings referencing it resolve. */
export function registerDrFont(form: PDFForm, font: PDFFont): void {
  const acroDict = form.acroForm.dict;
  const context = acroDict.context;
  let dr = acroDict.lookupMaybe(PDFName.of('DR'), PDFDict);
  if (!dr) {
    dr = context.obj({});
    acroDict.set(PDFName.of('DR'), dr);
  }
  let fonts = dr.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (!fonts) {
    fonts = context.obj({});
    dr.set(PDFName.of('Font'), fonts);
  }
  fonts.set(PDFName.of(font.name), font.ref);
}

/**
 * Regenerate appearance streams for every field. Checkbox/radio widgets that
 * carry no /MK style entry (faithful templates strip it) get the transparent
 * providers above; widgets with /MK (structural templates) keep the default
 * look. Text fields are always regenerated with the given font; signature
 * fields use `signatureFont` (auto-sized) when provided.
 */
export function refreshAppearances(
  form: PDFForm,
  font: PDFFont,
  options: { signatureFont?: PDFFont } = {},
): void {
  for (const field of form.getFields()) {
    const transparent = field.acroField.getWidgets().every((w) => !w.dict.has(MK));
    try {
      if (field instanceof PDFCheckBox) {
        if (transparent) field.updateAppearances(transparentCheckBoxProvider);
        else field.defaultUpdateAppearances();
      } else if (field instanceof PDFRadioGroup) {
        if (transparent) field.updateAppearances(transparentRadioGroupProvider);
        else field.defaultUpdateAppearances();
      } else if (field instanceof PDFTextField) {
        if (options.signatureFont && isSignatureField(field.getName())) {
          // Size 0 = auto-fit; pdf-lib rewrites the /DA with the real font
          // name and the size it lays out.
          field.acroField.dict.set(PDFName.of('DA'), PDFString.of('/SigF 0 Tf 0 g'));
          field.updateAppearances(options.signatureFont);
        } else {
          field.updateAppearances(font);
        }
      } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        field.updateAppearances(font);
      }
    } catch {
      // Leave the existing appearance in place if regeneration fails.
    }
  }
}
