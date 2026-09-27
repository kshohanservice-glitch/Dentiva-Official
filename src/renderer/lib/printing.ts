import { call } from './api';
import { getBridge, type PrintRequestPayload } from '../bridge';
import { PAPER_SIZES, type PaperSizeId } from '../../shared/constants';

export type PrintOutput = 'preview' | 'print' | 'pdf';

export interface PrintSpec {
  docKind: 'prescription' | 'invoice' | 'receipt' | 'patient-summary' | 'appointment-slip' | 'report';
  entityId: number | null;
  entityLabel: string;
  /** Data for the document renderer. */
  data: Record<string, unknown>;
  /** Attachment ids to inline as images (clinic logo, dentist signature). */
  logoAttachmentId?: number | null;
  signatureAttachmentId?: number | null;
  profileId?: number | null;
}

interface ResolvedProfile {
  id: number | null;
  printer_name: string;
  paper_id: PaperSizeId;
  paper_width_mm: number;
  paper_height_mm: number;
  margin_top_mm: number;
  margin_right_mm: number;
  margin_bottom_mm: number;
  margin_left_mm: number;
  orientation: 'portrait' | 'landscape';
  font_scale: number;
  copies: number;
  show_clinical_footer: number;
  resolvedWidthMm: number;
  resolvedHeightMm: number;
}

async function inlineImage(attachmentId: number | null | undefined): Promise<string | null> {
  if (!attachmentId) return null;
  try {
    const result = await call<{ mimeType: string; dataBase64: string }>('attachments.read', { id: attachmentId });
    return `data:${result.mimeType || 'image/png'};base64,${result.dataBase64}`;
  } catch {
    // A missing logo or signature must never block printing.
    return null;
  }
}

export async function buildPrintRequest(spec: PrintSpec, output: PrintOutput): Promise<PrintRequestPayload> {
  const profile = await call<ResolvedProfile>('printerProfiles.resolve', {
    docKind: spec.docKind,
    profileId: spec.profileId ?? undefined,
  });

  const [logo, signature] = await Promise.all([
    inlineImage(spec.logoAttachmentId),
    inlineImage(spec.signatureAttachmentId),
  ]);

  const data: Record<string, unknown> = {
    kind: spec.docKind,
    data: { ...spec.data, logoDataUrl: logo, signatureDataUrl: signature },
  };

  return {
    docKind: spec.docKind,
    entityId: spec.entityId,
    entityLabel: spec.entityLabel,
    paperId: profile.paper_id,
    widthMm: profile.resolvedWidthMm || PAPER_SIZES[profile.paper_id]?.width || 210,
    heightMm: profile.resolvedHeightMm || PAPER_SIZES[profile.paper_id]?.height || 297,
    orientation: profile.orientation,
    marginTopMm: Number(profile.margin_top_mm) || 10,
    marginRightMm: Number(profile.margin_right_mm) || 10,
    marginBottomMm: Number(profile.margin_bottom_mm) || 10,
    marginLeftMm: Number(profile.margin_left_mm) || 10,
    fontScale: Number(profile.font_scale) || 1,
    printerName: profile.printer_name ?? '',
    copies: Number(profile.copies) || 1,
    showClinicalFooter: Boolean(profile.show_clinical_footer),
    data,
    output,
  };
}

export interface PrintResult {
  ok: boolean;
  path?: string;
  bytes?: number;
  message?: string;
  browserPrint?: boolean;
}

export async function runPrint(spec: PrintSpec, output: PrintOutput, _token?: string | null): Promise<PrintResult> {
  const bridge = getBridge();
  const request = await buildPrintRequest(spec, output);
  const result =
    output === 'print'
      ? await bridge.printing.print(request)
      : output === 'pdf'
        ? await bridge.printing.pdf(request)
        : await bridge.printing.preview(request);
  return result as unknown as PrintResult;
}

/** System printer list for the print dialog. Falls back to an empty list gracefully. */
export async function listSystemPrinters(): Promise<string[]> {
  try {
    return await getBridge().printing.listSystemPrinters();
  } catch {
    return [];
  }
}
