import {
  createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type JSX, type ReactNode, type Ref,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icons';

/* ──────────────────────────────────────────────────────────────────────────
   Buttons
   ────────────────────────────────────────────────────────────────────────── */

export type ButtonVariant = 'default' | 'primary' | 'soft' | 'ghost' | 'danger' | 'danger-soft';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  block?: boolean;
  iconOnly?: boolean;
}

export function Button({
  variant = 'default', size = 'md', icon, iconRight, loading = false, block, iconOnly,
  className = '', children, disabled, type = 'button', ...rest
}: ButtonProps): JSX.Element {
  const classes = [
    'btn',
    variant !== 'default' ? `btn--${variant}` : '',
    size !== 'md' ? `btn--${size}` : '',
    block ? 'btn--block' : '',
    iconOnly ? 'btn--icon' : '',
    className,
  ].filter(Boolean).join(' ');
  const iconSize = size === 'sm' ? 15 : size === 'lg' ? 19 : 17;
  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="btn__spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {children ? <span>{children}</span> : null}
      {iconRight && !loading ? <Icon name={iconRight} size={iconSize} /> : null}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: number;
  badge?: number;
  active?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ icon, label, size = 18, badge, active, className = '', ref, ...rest }: IconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      ref={ref}
      className={`icon-btn ${className}`}
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      {...rest}
    >
      <Icon name={icon} size={size} />
      {badge !== undefined && badge > 0 ? (
        <span className="icon-btn__dot">{badge > 99 ? '99+' : badge}</span>
      ) : null}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Form fields
   ────────────────────────────────────────────────────────────────────────── */

export interface FieldProps {
  label?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

export function Field({ label, required, hint, error, htmlFor, children, className = '' }: FieldProps): JSX.Element {
  return (
    <div className={`field ${className}`}>
      {label ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="req" aria-hidden="true">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <span className="field-error" role="alert">
          <Icon name="alert-circle" size={13} />
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  );
}

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  icon?: IconName;
  inputSize?: 'sm' | 'md';
  wrapperClassName?: string;
  ref?: Ref<HTMLInputElement>;
}

export function TextInput({
  label, required, hint, error, icon, inputSize = 'md', wrapperClassName, className = '', id, ref, ...rest
}: TextInputProps): JSX.Element {
  const autoId = useId();
  const inputId = id ?? autoId;
  const input = (
    <input
      id={inputId}
      ref={ref}
      className={`input ${inputSize === 'sm' ? 'input--sm' : ''} ${className}`}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
      required={required}
      {...rest}
    />
  );
  return (
    <Field label={label} required={required} hint={hint} error={error} htmlFor={inputId} className={wrapperClassName}>
      {icon ? (
        <div className="input-affix">
          <span className="input-affix__icon"><Icon name={icon} size={15} /></span>
          {input}
        </div>
      ) : input}
    </Field>
  );
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  rows?: number;
}

export function TextArea({ label, required, hint, error, rows = 3, className = '', id, ...rest }: TextAreaProps): JSX.Element {
  const autoId = useId();
  const areaId = id ?? autoId;
  return (
    <Field label={label} required={required} hint={hint} error={error} htmlFor={areaId}>
      <textarea
        id={areaId}
        rows={rows}
        className={`textarea ${className}`}
        aria-invalid={error ? true : undefined}
        required={required}
        {...rest}
      />
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
  inputSize?: 'sm' | 'md';
}

export function Select({
  label, required, hint, error, options, placeholder, inputSize = 'md', className = '', id, ...rest
}: SelectProps): JSX.Element {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <Field label={label} required={required} hint={hint} error={error} htmlFor={selectId}>
      <select
        id={selectId}
        className={`select ${inputSize === 'sm' ? 'input--sm' : ''} ${className}`}
        aria-invalid={error ? true : undefined}
        required={required}
        {...rest}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  indeterminate?: boolean;
}

export function Checkbox({ label, indeterminate, className = '', ...rest }: CheckboxProps): JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <label className={`checkbox ${className}`}>
      <input ref={ref} type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export function Radio({ label, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }): JSX.Element {
  return (
    <label className="radio">
      <input type="radio" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}

export function Switch({ checked, onChange, label, disabled, id }: SwitchProps): JSX.Element {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export function Segmented<T extends string>({
  value, onChange, options, label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  label: string;
}): JSX.Element {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className="row row-1"
          style={{ gap: 5 }}
        >
          {option.icon ? <Icon name={option.icon} size={14} /> : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Layout primitives
   ────────────────────────────────────────────────────────────────────────── */

export function Card({
  title, subtitle, actions, children, footer, className = '', flush, icon,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  flush?: boolean;
  icon?: IconName;
}): JSX.Element {
  return (
    <section className={`card ${className}`}>
      {title ? (
        <header className="card-head">
          <div style={{ minWidth: 0 }}>
            <h2 className="card-title">
              {icon ? <Icon name={icon} size={17} /> : null}
              <span className="truncate">{title}</span>
            </h2>
            {subtitle ? <div className="card-subtitle">{subtitle}</div> : null}
          </div>
          {actions ? <div className="row row-2 shrink-0">{actions}</div> : null}
        </header>
      ) : null}
      <div className={`card-body ${flush ? 'card-body--flush' : ''}`}>{children}</div>
      {footer ? <footer className="card-foot">{footer}</footer> : null}
    </section>
  );
}

export function PageHeader({
  title, subtitle, actions, breadcrumb, icon,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: { label: string; href?: string }[];
  icon?: IconName;
}): JSX.Element {
  return (
    <header className="page-head">
      <div className="page-head-main">
        {breadcrumb && breadcrumb.length ? (
          <nav className="breadcrumb" aria-label="Breadcrumb">
            {breadcrumb.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} className="row row-1" style={{ gap: 6 }}>
                {index > 0 ? <Icon name="chevron-right" size={12} className="text-3" /> : null}
                {crumb.href ? (
                  <a href={crumb.href} onClick={(event) => { event.preventDefault(); window.location.hash = `#/${crumb.href}`; }}>
                    {crumb.label}
                  </a>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="page-title">
          {icon ? <Icon name={icon} size={22} className="text-primary shrink-0" /> : null}
          <span className="truncate">{title}</span>
        </h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'primary';

export function Badge({ tone = 'neutral', children, dot, className = '' }: { tone?: BadgeTone; children: ReactNode; dot?: boolean; className?: string }): JSX.Element {
  return <span className={`badge ${tone !== 'neutral' ? `badge--${tone}` : ''} ${dot ? 'badge--dot' : ''} ${className}`}>{children}</span>;
}

export function Avatar({ name, src, size = 'md' }: { name: string; src?: string | null; size?: 'sm' | 'md' | 'lg' }): JSX.Element {
  const initials = useMemo(
    () => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?',
    [name],
  );
  return (
    <span className={`avatar ${size !== 'md' ? `avatar--${size}` : ''}`} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initials}
    </span>
  );
}

export function Stat({
  label, value, meta, icon, tone = 'primary', onClick, href,
}: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  icon: IconName;
  tone?: 'primary' | 'ok' | 'warn' | 'danger' | 'info';
  onClick?: () => void;
  href?: string;
}): JSX.Element {
  const inner = (
    <>
      <div className="stat-head">
        <span className="stat-label">{label}</span>
        <span className={`stat-icon ${tone !== 'primary' ? `stat-icon--${tone}` : ''}`}>
          <Icon name={icon} size={16} />
        </span>
      </div>
      <div className="stat-value">{value}</div>
      {meta ? <div className="stat-meta">{meta}</div> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="stat text-left" onClick={onClick}>
        {inner}
      </button>
    );
  }
  if (href) {
    return (
      <a className="stat" href={`#/${href}`} style={{ textDecoration: 'none', color: 'inherit' }}>
        {inner}
      </a>
    );
  }
  return <div className="stat">{inner}</div>;
}

export function Callout({
  tone = 'info', title, children, actions,
}: {
  tone?: 'info' | 'warn' | 'danger' | 'ok';
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}): JSX.Element {
  const icon: IconName = tone === 'danger' ? 'alert-triangle' : tone === 'warn' ? 'alert-triangle' : tone === 'ok' ? 'check-circle' : 'info-circle';
  return (
    <div className={`callout callout--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="callout-icon"><Icon name={icon} size={17} /></span>
      <div className="grow stack stack-1">
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
        {actions ? <div className="row row-2" style={{ marginTop: 6 }}>{actions}</div> : null}
      </div>
    </div>
  );
}

export function Divider({ vertical }: { vertical?: boolean }): JSX.Element {
  return <span className={vertical ? 'vdivider' : 'divider'} aria-hidden="true" />;
}

/* ──────────────────────────────────────────────────────────────────────────
   States
   ────────────────────────────────────────────────────────────────────────── */

export function EmptyState({
  icon = 'info-circle', title, text, primary, secondary, compact,
}: {
  icon?: IconName;
  title: string;
  text?: ReactNode;
  primary?: ReactNode;
  secondary?: ReactNode;
  compact?: boolean;
}): JSX.Element {
  return (
    <div className={`state ${compact ? 'state--compact' : ''}`}>
      <div className="state-icon"><Icon name={icon} size={24} /></div>
      <div className="state-title">{title}</div>
      {text ? <div className="state-text">{text}</div> : null}
      {primary || secondary ? (
        <div className="state-actions">
          {primary}
          {secondary}
        </div>
      ) : null}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }): JSX.Element {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className={`state state--error ${compact ? 'state--compact' : ''}`} role="alert">
      <div className="state-icon"><Icon name="alert-triangle" size={24} /></div>
      <div className="state-title">This could not be loaded</div>
      <div className="state-text">{message}</div>
      {onRetry ? (
        <div className="state-actions">
          <Button variant="primary" icon="refresh" onClick={onRetry}>Try again</Button>
        </div>
      ) : null}
    </div>
  );
}

export function Skeleton({ width, height, className = '', style }: { width?: number | string; height?: number | string; className?: string; style?: React.CSSProperties }): JSX.Element {
  return <span className={`skeleton ${className}`} style={{ width, height, display: 'block', ...style }} aria-hidden="true" />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }): JSX.Element {
  return (
    <div style={{ padding: 12 }} aria-busy="true" aria-label="Loading data">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="row" style={{ gap: 16, padding: '9px 0' }}>
          {Array.from({ length: cols }).map((__, colIndex) => (
            <Skeleton key={colIndex} width={colIndex === 0 ? '24%' : `${Math.max(10, 18 - colIndex * 2)}%`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function LoadingBar({ visible }: { visible: boolean }): JSX.Element | null {
  if (!visible) return null;
  return <div className="loading-bar" role="progressbar" aria-label="Loading" />;
}

export function Spinner({ label = 'Loading' }: { label?: string }): JSX.Element {
  return <span className="spinner" role="status" aria-label={label} />;
}

/* ──────────────────────────────────────────────────────────────────────────
   Modal + confirm
   ────────────────────────────────────────────────────────────────────────── */

export interface ModalProps {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  height?: string;
  closeOnBackdrop?: boolean;
  initialFocus?: 'first-input' | 'none';
}

export function Modal({
  open, title, subtitle, onClose, children, footer, width = 640, height, closeOnBackdrop = true, initialFocus = 'first-input',
}: ModalProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => {
      if (initialFocus === 'first-input') {
        const focusable = panelRef.current?.querySelector<HTMLElement>(
          'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
        );
        (focusable ?? panelRef.current)?.focus();
      } else {
        panelRef.current?.focus();
      }
    }, 30);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const nodes = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((node) => node.offsetParent !== null);
      if (nodes.length === 0) return;
      const first = nodes[0] as HTMLElement;
      const last = nodes[nodes.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [open, onClose, initialFocus]);

  if (!open) return null;
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        tabIndex={-1}
        style={{ ['--modal-w' as string]: `${width}px`, ['--modal-h' as string]: height ?? '88vh' }}
      >
        <header className="modal-head">
          <div style={{ minWidth: 0 }}>
            <h2 className="modal-title" id={titleId}>{title}</h2>
            {subtitle ? <p className="modal-subtitle">{subtitle}</p> : null}
          </div>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmRequest {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  requireText?: string;
  detail?: string;
}

interface ConfirmContextValue {
  confirm: (request: ConfirmRequest) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue>({ confirm: async () => false });

export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [typed, setTyped] = useState('');
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useMemo<ConfirmContextValue['confirm']>(
    () => (next) => new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setTyped('');
      setRequest(next);
    }),
    [],
  );

  const finish = useMemo(
    () => (value: boolean) => {
      resolver.current?.(value);
      resolver.current = null;
      setRequest(null);
      setTyped('');
    },
    [],
  );

  const blocked = Boolean(request?.requireText) && typed.trim() !== request?.requireText;

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <Modal
        open={Boolean(request)}
        title={request?.title ?? ''}
        onClose={() => finish(false)}
        width={520}
        closeOnBackdrop={false}
        footer={
          <>
            <Button onClick={() => finish(false)}>{request?.cancelLabel ?? 'Cancel'}</Button>
            <Button
              variant={request?.tone === 'danger' ? 'danger' : 'primary'}
              disabled={blocked}
              onClick={() => finish(true)}
            >
              {request?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        <div className="stack stack-3">
          <div>{request?.message}</div>
          {request?.detail ? <Callout tone="warn">{request.detail}</Callout> : null}
          {request?.requireText ? (
            <Field label={`Type ${request.requireText} to confirm`} required>
              <input
                className="input"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          ) : null}
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue['confirm'] {
  return useContext(ConfirmContext).confirm;
}

/* ──────────────────────────────────────────────────────────────────────────
   Toasts
   ────────────────────────────────────────────────────────────────────────── */

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  text?: string;
  timeout: number;
}

interface ToastContextValue {
  push: (toast: Omit<ToastItem, 'id' | 'timeout'> & { timeout?: number }) => void;
  success: (title: string, text?: string) => void;
  error: (title: string, text?: string) => void;
  warning: (title: string, text?: string) => void;
  info: (title: string, text?: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  push: () => {},
  success: () => {},
  error: () => {},
  warning: () => {},
  info: () => {},
});

const TOAST_ICONS: Record<ToastTone, IconName> = {
  success: 'check-circle',
  error: 'x-circle',
  warning: 'alert-triangle',
  info: 'info-circle',
};

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const remove = useMemo(
    () => (id: number) => setItems((current) => current.filter((item) => item.id !== id)),
    [],
  );

  const value = useMemo<ToastContextValue>(() => {
    const push: ToastContextValue['push'] = (toast) => {
      counter.current += 1;
      const id = counter.current;
      const item: ToastItem = { id, timeout: toast.timeout ?? (toast.tone === 'error' ? 9000 : 4500), ...toast };
      setItems((current) => [...current.slice(-4), item]);
      window.setTimeout(() => remove(id), item.timeout);
    };
    return {
      push,
      success: (title, text) => push({ tone: 'success', title, text }),
      error: (title, text) => push({ tone: 'error', title, text }),
      warning: (title, text) => push({ tone: 'warning', title, text }),
      info: (title, text) => push({ tone: 'info', title, text }),
    };
  }, [remove]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="toast-region" role="region" aria-label="Notifications" aria-live="polite">
          {items.map((item) => (
            <div key={item.id} className={`toast toast--${item.tone}`} role={item.tone === 'error' ? 'alert' : 'status'}>
              <span className="toast-icon"><Icon name={TOAST_ICONS[item.tone]} size={18} /></span>
              <div className="toast-body">
                <div className="toast-title">{item.title}</div>
                {item.text ? <div className="toast-text">{item.text}</div> : null}
              </div>
              <IconButton icon="x" label="Dismiss" size={15} onClick={() => remove(item.id)} />
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

/* ──────────────────────────────────────────────────────────────────────────
   Tabs
   ────────────────────────────────────────────────────────────────────────── */

export interface TabItem {
  id: string;
  label: string;
  icon?: IconName;
  count?: number;
  permission?: string;
}

export function Tabs({
  items, value, onChange, ariaLabel,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = items.findIndex((item) => item.id === value);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = event.key === 'ArrowRight' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
      const target = items[next];
      if (target) {
        onChange(target.id);
        listRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${target.id}"]`)?.focus();
      }
    }
  };
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel} ref={listRef} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          data-tab={item.id}
          className="tab"
          aria-selected={item.id === value}
          tabIndex={item.id === value ? 0 : -1}
          onClick={() => onChange(item.id)}
        >
          {item.icon ? <Icon name={item.icon} size={15} /> : null}
          {item.label}
          {item.count !== undefined ? <span className="tab-count">{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Popover / menu
   ────────────────────────────────────────────────────────────────────────── */

export function Popover({
  open, onClose, anchorRef, children, align = 'end', width,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  align?: 'start' | 'end';
  width?: number;
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ top: 0, left: 0, visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const widthPx = width ?? ref.current?.offsetWidth ?? 300;
    const heightPx = ref.current?.offsetHeight ?? 300;
    let left = align === 'end' ? anchor.right - widthPx : anchor.left;
    left = Math.max(8, Math.min(left, window.innerWidth - widthPx - 8));
    let top = anchor.bottom + 6;
    if (top + heightPx > window.innerHeight - 8) top = Math.max(8, anchor.top - heightPx - 6);
    setStyle({ top, left, width: widthPx, visibility: 'visible' });
  }, [open, anchorRef, align, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node) || anchorRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div ref={ref} className={width ? 'popover' : 'menu'} style={style} role="dialog">
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  icon, children, onClick, danger, disabled,
}: {
  icon?: IconName;
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button type="button" className={`menu-item ${danger ? 'menu-item--danger' : ''}`} onClick={onClick} disabled={disabled}>
      {icon ? <Icon name={icon} size={16} /> : null}
      <span className="truncate">{children}</span>
    </button>
  );
}

export function MenuSeparator(): JSX.Element {
  return <div className="menu-sep" role="separator" />;
}

/* ──────────────────────────────────────────────────────────────────────────
   Data table
   ────────────────────────────────────────────────────────────────────────── */

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T, index: number) => ReactNode;
  numeric?: boolean;
  width?: number | string;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  hideBelow?: number;
}

export function DataTable<T extends { id: number | string }>({
  columns, rows, loading, error, empty, onRetry, onRowClick, selectedKey, footer, compact, maxHeight,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  error?: unknown;
  empty?: ReactNode;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  selectedKey?: string | number | null;
  footer?: ReactNode;
  compact?: boolean;
  maxHeight?: number | string;
}): JSX.Element {
  if (loading) return <TableSkeleton rows={6} cols={Math.min(6, columns.length)} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} compact />;
  if (rows.length === 0) return <>{empty ?? <EmptyState icon="database" title="Nothing to show" compact />}</>;

  return (
    <>
      <div className="table-wrap" style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
        <table className={`table ${compact ? 'table--compact' : ''}`}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={column.numeric || column.align === 'right' ? 'num' : ''}
                  style={{ width: column.width, textAlign: column.align }}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.id}
                data-clickable={onRowClick ? 'true' : undefined}
                data-selected={selectedKey !== undefined && selectedKey === row.id ? 'true' : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
              >
                {columns.map((column) => (
                  <td key={column.key} className={column.numeric || column.align === 'right' ? 'num' : ''} style={{ textAlign: column.align }}>
                    {column.render(row, index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer ? <tfoot>{footer}</tfoot> : null}
        </table>
      </div>
    </>
  );
}

export function Pagination({
  page, pageCount, total, pageSize, onPage, onPageSize, pageSizeOptions = [10, 25, 50, 100],
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
  pageSizeOptions?: number[];
}): JSX.Element {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pagination">
      <span>
        {total === 0 ? 'No records' : `${from}–${to} of ${total}`}
      </span>
      <div className="row row-2">
        {onPageSize ? (
          <label className="row row-1" style={{ fontSize: 'var(--fs-sm)' }}>
            <span className="text-3">Rows</span>
            <select
              className="select input--sm"
              style={{ width: 72, height: 28 }}
              value={pageSize}
              onChange={(event) => onPageSize(Number(event.target.value))}
              aria-label="Rows per page"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        ) : null}
        <Button size="sm" icon="chevrons-left" aria-label="First page" disabled={page <= 1} onClick={() => onPage(1)} />
        <Button size="sm" icon="chevron-left" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} />
        <span className="text-sm" style={{ minWidth: 78, textAlign: 'center' }}>
          Page {page} of {pageCount}
        </span>
        <Button size="sm" icon="chevron-right" aria-label="Next page" disabled={page >= pageCount} onClick={() => onPage(page + 1)} />
        <Button size="sm" icon="chevrons-right" aria-label="Last page" disabled={page >= pageCount} onClick={() => onPage(pageCount)} />
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Async resource hook — small, typed, no external state library
   ────────────────────────────────────────────────────────────────────────── */

export interface Resource<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
  setData: (value: T | null) => void;
}

export function useResource<T>(loader: () => Promise<T>, deps: unknown[]): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loaderRef.current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, reload: () => setNonce((n) => n + 1), setData };
}

export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useOnClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  handler: () => void,
  active = true,
): void {
  useEffect(() => {
    if (!active) return;
    const listener = (event: MouseEvent | TouchEvent) => {
      const element = ref.current;
      if (!element || element.contains(event.target as Node)) return;
      handler();
    };
    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);
    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [ref, handler, active]);
}
