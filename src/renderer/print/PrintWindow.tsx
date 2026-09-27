import { useEffect, useState, type JSX } from 'react';
import { getBridge, isPrintWindowRuntime, type PrintRequestPayload } from '../bridge';
import { PAPER_SIZES, type PaperSizeId } from '../../shared/constants';
import { PrescriptionDocument, type PrescriptionModel } from './PrescriptionDoc';
import { InvoiceDocument, type InvoiceModel } from './InvoiceDoc';
import { ReceiptDocument, type ReceiptModel } from './ReceiptDoc';
import { PatientSummaryDocument, type PatientSummaryModel } from './SummaryDoc';
import { AppointmentSlipDocument, type AppointmentSlipModel } from './SlipDoc';
import { ReportDocument, type ReportModel } from './ReportDoc';
import { Icon } from '../components/Icons';
import { Button, Select, Checkbox } from '../components/ui';
import type { DisplayPrefs } from '../lib/format';

const DEFAULT_PREFS: DisplayPrefs = { bengaliNumerals: false, dateFormat: 'dmy', timeFormat: '12h' };

interface DocumentEnvelope {
  kind: string;
  data: unknown;
}

function pageStyle(request: PrintRequestPayload): { style: React.CSSProperties; narrow: boolean; roll: boolean } {
  const paper = PAPER_SIZES[(request.paperId || 'a4') as PaperSizeId] ?? PAPER_SIZES.a4;
  let width = request.widthMm > 0 ? request.widthMm : paper.width;
  let height = request.heightMm > 0 ? request.heightMm : paper.height;
  const landscape = request.orientation === 'landscape';
  if (landscape && height > 0 && width < height) [width, height] = [height, width];
  return {
    style: {
      ['--page-w' as string]: `${width}mm`,
      ['--page-h' as string]: height > 0 ? `${height}mm` : 'auto',
      ['--page-pad-x' as string]: `${Math.max(4, request.marginLeftMm || 10)}mm`,
      ['--page-pad-y' as string]: `${Math.max(4, request.marginTopMm || 10)}mm`,
      ['--doc-font-scale' as string]: String(request.fontScale || 1),
    },
    narrow: width <= 120,
    roll: height <= 0,
  };
}

function renderDocument(request: PrintRequestPayload, prefs: DisplayPrefs): JSX.Element {
  const envelope = (request.data ?? {}) as DocumentEnvelope;
  switch (envelope.kind) {
    case 'prescription':
      return <PrescriptionDocument model={envelope.data as PrescriptionModel} prefs={prefs} showClinicalFooter={request.showClinicalFooter} />;
    case 'invoice':
      return <InvoiceDocument model={envelope.data as InvoiceModel} prefs={prefs} />;
    case 'receipt':
      return <ReceiptDocument model={envelope.data as ReceiptModel} prefs={prefs} />;
    case 'patient-summary':
      return <PatientSummaryDocument model={envelope.data as PatientSummaryModel} prefs={prefs} />;
    case 'appointment-slip':
      return <AppointmentSlipDocument model={envelope.data as AppointmentSlipModel} prefs={prefs} />;
    case 'report':
      return <ReportDocument model={envelope.data as ReportModel} prefs={prefs} />;
    default:
      return (
        <div className="doc-section">
          <div className="doc-section-label">Unsupported document</div>
          <div className="doc-section-body">
            This document type ({envelope.kind || 'unknown'}) cannot be rendered. Report it to your administrator.
          </div>
        </div>
      );
  }
}

export function PrintWindow(): JSX.Element {
  const [request, setRequest] = useState<PrintRequestPayload | null>(null);
  const [prefs, setPrefs] = useState<DisplayPrefs>(DEFAULT_PREFS);
  const [busy, setBusy] = useState<'' | 'print' | 'pdf'>('');
  const [message, setMessage] = useState('');
  const [autoOutput, setAutoOutput] = useState<'print' | 'pdf' | null>(null);

  useEffect(() => {
    const bridge = getBridge();
    const off = bridge.printing.onData((payload) => {
      setRequest(payload);
      setPrefs((current) => ({
        ...current,
        bengaliNumerals: Boolean((payload.data as { settings?: { bengaliNumerals?: boolean } } | undefined)?.settings?.bengaliNumerals ?? current.bengaliNumerals),
        dateFormat: (payload.data as { settings?: { dateFormat?: DisplayPrefs['dateFormat'] } } | undefined)?.settings?.dateFormat ?? current.dateFormat,
        timeFormat: (payload.data as { settings?: { timeFormat?: DisplayPrefs['timeFormat'] } } | undefined)?.settings?.timeFormat ?? current.timeFormat,
      }));
    });
    void bridge.printing.signalReady();

    if (!isPrintWindowRuntime()) {
      // Browser preview: the opener posts the request directly.
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        const data = event.data as { type?: string; request?: PrintRequestPayload; auto?: 'print' | 'pdf' };
        if (data?.type === 'dentiva:print-data' && data.request) {
          setRequest(data.request);
          if (data.auto) setAutoOutput(data.auto);
          window.opener?.postMessage({ type: 'dentiva:print-ready' }, window.location.origin);
        }
      };
      window.addEventListener('message', onMessage);
      if (window.opener) window.opener.postMessage({ type: 'dentiva:print-ready' }, window.location.origin);
      return () => {
        off();
        window.removeEventListener('message', onMessage);
      };
    }
    return off;
  }, []);

  // Browser preview auto-output once the DOM has painted.
  useEffect(() => {
    if (!autoOutput || !request) return;
    setAutoOutput(null);
    const timer = window.setTimeout(() => {
      window.print();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [autoOutput, request]);

  const run = async (output: 'print' | 'pdf') => {
    if (!request) return;
    setBusy(output);
    setMessage('');
    try {
      const bridge = getBridge();
      if (isPrintWindowRuntime()) {
        const result = await bridge.printing.action(0, { ...request, output });
        const bytes = Number(result?.bytes ?? 0);
        setMessage(output === 'pdf' ? `PDF saved (${(bytes / 1024).toFixed(0)} KB).` : 'Sent to the printer.');
      } else {
        window.print();
        setMessage(output === 'pdf' ? 'Choose “Save as PDF” as the destination in the print dialog.' : 'Print dialog opened.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The print action failed.');
    } finally {
      setBusy('');
    }
  };

  const geometry = request ? pageStyle(request) : null;

  return (
    <div className="print-root" style={geometry?.style}>
      {isPrintWindowRuntime() ? (
        <div className="print-toolbar no-print">
          <strong style={{ fontSize: 13 }}>Print preview</strong>
          <span className="print-hint">{request ? `${request.entityLabel} · ${request.paperId}` : 'Preparing…'}</span>
          <span className="spacer" />
          {request ? (
            <Select
              aria-label="Paper size"
              inputSize="sm"
              style={{ width: 150 }}
              value={request.paperId}
              options={Object.values(PAPER_SIZES).map((paper) => ({ value: paper.id, label: paper.label }))}
              onChange={(event) => setRequest({ ...request, paperId: event.target.value })}
            />
          ) : null}
          {request ? (
            <Select
              aria-label="Orientation"
              inputSize="sm"
              style={{ width: 130 }}
              value={request.orientation}
              options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]}
              onChange={(event) => setRequest({ ...request, orientation: event.target.value as 'portrait' | 'landscape' })}
            />
          ) : null}
          {request ? (
            <Select
              aria-label="Copies"
              inputSize="sm"
              style={{ width: 84 }}
              value={String(request.copies ?? 1)}
              options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} copy${n === 1 ? '' : 'ies'}` }))}
              onChange={(event) => setRequest({ ...request, copies: Number(event.target.value) })}
            />
          ) : null}
          {request ? (
            <Checkbox
              label="Clinical footer"
              checked={request.showClinicalFooter}
              onChange={(event) => setRequest({ ...request, showClinicalFooter: event.target.checked })}
            />
          ) : null}
          <Button variant="primary" icon="printer" loading={busy === 'print'} onClick={() => void run('print')}>
            Print
          </Button>
          <Button variant="soft" icon="download" loading={busy === 'pdf'} onClick={() => void run('pdf')}>
            Save PDF
          </Button>
          <Button icon="x" onClick={() => window.close()}>Close</Button>
        </div>
      ) : null}

      {message ? (
        <div className="no-print" style={{ maxWidth: 720, margin: '0 auto 10px', fontSize: 12, color: '#0a8076' }}>
          <Icon name="check-circle" size={13} /> {message}
        </div>
      ) : null}

      <div className="doc-page" data-narrow={geometry?.narrow} data-roll={geometry?.roll}>
        {request ? renderDocument(request, prefs) : <div className="doc-section-body">Preparing document…</div>}
      </div>
    </div>
  );
}
