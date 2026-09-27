import type { JSX, SVGProps } from 'react';

/**
 * Icon set — a single, consistent 24×24 stroke family.
 * Every glyph shares the same 1.7px stroke, round caps and optical box so the
 * UI never mixes icon styles.
 */

export type IconName =
  | 'dashboard' | 'patients' | 'calendar' | 'queue' | 'treatments' | 'prescription'
  | 'invoice' | 'payments' | 'inventory' | 'accounting' | 'staff' | 'backup'
  | 'settings' | 'info' | 'search' | 'bell' | 'lock' | 'user' | 'logout' | 'plus'
  | 'edit' | 'trash' | 'eye' | 'print' | 'download' | 'upload' | 'file' | 'file-text'
  | 'chevron-left' | 'chevron-right' | 'chevron-down' | 'chevron-up' | 'chevrons-left'
  | 'chevrons-right' | 'check' | 'check-circle' | 'alert-triangle' | 'alert-circle'
  | 'info-circle' | 'x' | 'x-circle' | 'refresh' | 'filter' | 'more-horizontal'
  | 'more-vertical' | 'phone' | 'mail' | 'map-pin' | 'clock' | 'calendar-check'
  | 'clipboard' | 'stethoscope' | 'tooth' | 'activity' | 'trending-up' | 'trending-down'
  | 'package' | 'truck' | 'shield' | 'database' | 'folder' | 'folder-open'
  | 'copy' | 'star' | 'star-filled' | 'arrow-left' | 'arrow-right' | 'external-link'
  | 'menu' | 'panel-left' | 'key' | 'sun' | 'moon' | 'minus' | 'play' | 'pause'
  | 'skip' | 'printer' | 'paperclip' | 'grid' | 'list' | 'sort-asc' | 'send'
  | 'user-plus' | 'user-check' | 'credit-card' | 'wallet' | 'receipt' | 'ban'
  | 'rotate-ccw' | 'save' | 'image' | 'type' | 'hash' | 'percent' | 'archive'
  | 'building' | 'receipt-text' | 'chart' | 'sliders' | 'power';

const PATHS: Record<IconName, JSX.Element> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  patients: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /><path d="M16 5.5a3 3 0 0 1 0 5.6" /><path d="M17.5 15.2c1.9.6 3.2 2.1 3.2 4.3" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  queue: <><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="19" cy="18" r="2.4" /></>,
  treatments: <><path d="M12 3v18" /><path d="M7 7h10l-2.2 4.2a5 5 0 0 1-5.6 0L7 7Z" /><circle cx="12" cy="16" r="2.4" /></>,
  prescription: <><path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></>,
  invoice: <><path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z" /><path d="M9 7h6M9 11h6M9 15h3" /></>,
  payments: <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19" /><path d="M6 14.5h3.5" /></>,
  inventory: <><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" /></>,
  accounting: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
  staff: <><circle cx="12" cy="7" r="3.2" /><path d="M5.5 20c0-3.4 2.9-5.6 6.5-5.6s6.5 2.2 6.5 5.6" /></>,
  backup: <><path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z" /><path d="M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></>,
  bell: <><path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" /><path d="M13.7 19a2 2 0 0 1-3.4 0" /></>,
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  user: <><circle cx="12" cy="8" r="3.6" /><path d="M4.8 20c0-3.6 3.2-6 7.2-6s7.2 2.4 7.2 6" /></>,
  logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5M5 12h11" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  edit: <><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="m14 6 4 4" /></>,
  trash: <><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /><path d="M10 11v6M14 11v6" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>,
  print: <><path d="M7 8V3h10v5" /><rect x="3" y="8" width="18" height="8" rx="2" /><path d="M7 14h10v7H7z" /></>,
  download: <><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" /><path d="M4 20h16" /></>,
  upload: <><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5" /><path d="M4 20h16" /></>,
  file: <><path d="M6 2h8l5 5v15H6z" /><path d="M14 2v5h5" /></>,
  'file-text': <><path d="M6 2h8l5 5v15H6z" /><path d="M14 2v5h5M9 13h6M9 17h4" /></>,
  'chevron-left': <path d="m14 6-6 6 6 6" />,
  'chevron-right': <path d="m10 6 6 6-6 6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-up': <path d="m6 15 6-6 6 6" />,
  'chevrons-left': <><path d="m11 6-6 6 6 6" /><path d="m19 6-6 6 6 6" /></>,
  'chevrons-right': <><path d="m13 6 6 6-6 6" /><path d="m5 6 6 6-6 6" /></>,
  check: <path d="m5 13 4.5 4.5L19 7" />,
  'check-circle': <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-5.5" /></>,
  'alert-triangle': <><path d="M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
  'alert-circle': <><circle cx="12" cy="12" r="9" /><path d="M12 8v4.5M12 16h.01" /></>,
  'info-circle': <><circle cx="12" cy="12" r="9" /><path d="M12 16v-4.5M12 8h.01" /></>,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  'x-circle': <><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></>,
  refresh: <><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></>,
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />,
  'more-horizontal': <><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>,
  'more-vertical': <><circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" /></>,
  phone: <path d="M6.6 3h2.8l1.5 4-2 1.4a12 12 0 0 0 5.7 5.7l1.4-2 4 1.5v2.8a2 2 0 0 1-2.2 2A17 17 0 0 1 4.6 5.2 2 2 0 0 1 6.6 3Z" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 7 8.5 6 8.5-6" /></>,
  'map-pin': <><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></>,
  'calendar-check': <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4" /></>,
  clipboard: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1H9V4Z" /><path d="M9 11h6M9 15h4" /></>,
  stethoscope: <><path d="M6 3v5a4 4 0 0 0 8 0V3" /><path d="M6 3H4.5M14 3h1.5" /><path d="M10 16v-4" /><circle cx="17" cy="16" r="3" /></>,
  tooth: <path d="M7.5 3.2C5 3.2 3 5.2 3 8c0 2 .5 3.3 1 4.8.4 1.2.4 2.4.6 3.8.2 1.6.6 3.4 1.6 3.4 1.1 0 1.2-1.6 1.4-3 .2-1.2.3-2.4.4-3 .2-.6.5-.9 1-.9s.8.3 1 .9c.1.6.2 1.8.4 3 .2 1.4.3 3 1.4 3 1 0 1.4-1.8 1.6-3.4.2-1.4.2-2.6.6-3.8.5-1.5 1-2.8 1-4.8 0-2.8-2-4.8-4.5-4.8-1 0-1.7.4-2.5.4s-1.5-.4-2.5-.4Z" />,
  activity: <path d="M3 12h4l2.5-7 4 14L16 12h5" />,
  'trending-up': <><path d="m3 17 6-6 4 4 7-7" /><path d="M14 8h6v6" /></>,
  'trending-down': <><path d="m3 7 6 6 4-4 7 7" /><path d="M14 16h6v-6" /></>,
  package: <><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" /><path d="M3 7.5 12 12l9-4.5M12 12v9M7.5 5.2l9 4.6" /></>,
  truck: <><path d="M2 6h11v10H2z" /><path d="M13 9h4.5l3 3.5V16H13z" /><circle cx="6.5" cy="18" r="1.8" /><circle cx="16.5" cy="18" r="1.8" /></>,
  shield: <><path d="M12 3 5 6v6c0 4.2 2.9 7.9 7 9 4.1-1.1 7-4.8 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
  database: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  'folder-open': <><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V11H5.5L3 19V7Z" /><path d="M3 19h18l-2.2-8H5.2L3 19Z" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>,
  star: <path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 9.7l5.4-.8L12 4Z" />,
  'star-filled': <path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.7l5.8-.8L12 3.6Z" />,
  'arrow-left': <><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></>,
  'arrow-right': <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  'external-link': <><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  'panel-left': <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  key: <><circle cx="8" cy="14" r="4" /><path d="m11 11 8-8 2 2-2 2 2 2-2 2-2-2-2 2" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  minus: <path d="M5 12h14" />,
  play: <path d="M7 4.5 19 12 7 19.5v-15Z" />,
  pause: <><path d="M9 5v14M15 5v14" /></>,
  skip: <><path d="M6 5.5 15 12l-9 6.5v-13Z" /><path d="M18 5v14" /></>,
  printer: <><path d="M7 8V3h10v5" /><rect x="3" y="8" width="18" height="8" rx="2" /><path d="M7 14h10v7H7z" /><path d="M17 11h.01" /></>,
  paperclip: <path d="M20 11.5 12.3 19a5 5 0 0 1-7-7l8-8a3.4 3.4 0 1 1 4.8 4.8l-7.9 7.9a1.8 1.8 0 1 1-2.5-2.5l7.2-7.2" />,
  grid: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  'sort-asc': <><path d="M4 7h10M4 12h7M4 17h4" /><path d="M17 5v14M17 19l-3-3M17 19l3-3" /></>,
  send: <><path d="M21 3 10.5 13.5" /><path d="M21 3 14.5 21l-4-8-8-4 18.5-6Z" /></>,
  'user-plus': <><circle cx="9" cy="8" r="3.4" /><path d="M3 20c0-3.2 2.7-5.4 6-5.4 1.2 0 2.3.3 3.2.8" /><path d="M18 14v6M15 17h6" /></>,
  'user-check': <><circle cx="9" cy="8" r="3.4" /><path d="M3 20c0-3.2 2.7-5.4 6-5.4 1.1 0 2.2.2 3.1.7" /><path d="m15.5 17 2 2 3.5-4" /></>,
  'credit-card': <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19" /><path d="M6 14.5h3" /></>,
  wallet: <><path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2" /><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M16 13.5h2" /></>,
  receipt: <><path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z" /><path d="M9.5 8h5M9.5 12h5" /></>,
  ban: <><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>,
  'rotate-ccw': <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></>,
  save: <><path d="M5 3h11l3 3v15H5z" /><path d="M8 3v6h8V3M8 21v-7h8v7" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="m4 17 5-5 4 4 3-3 4 4" /></>,
  type: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  hash: <><path d="M5 9h14M5 15h14M10 4 8.5 20M15.5 4 14 20" /></>,
  percent: <><circle cx="7" cy="7" r="2" /><circle cx="17" cy="17" r="2" /><path d="m5 19 14-14" /></>,
  building: <><path d="M3 21h18" /><path d="M5 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16" /><path d="M16 9h3a2 2 0 0 1 2 2v10" /><path d="M9 7h3M9 11h3M9 15h3" /><path d="M2 21h20" /></>,
  'receipt-text': <><path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  chart: <><path d="M4 20V6" /><path d="M4 20h16" /><rect x="7" y="12" width="3" height="5" /><rect x="12" y="8" width="3" height="9" /><rect x="17" y="10" width="3" height="7" /></>,
  sliders: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  power: <><path d="M12 3v9" /><path d="M6.5 7.5a7 7 0 1 0 11 0" /></>,
  archive: <><rect x="3" y="4" width="18" height="4.5" rx="1.5" /><path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5" /><path d="M10 12.5h4" /></>,
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  filled?: boolean;
  title?: string;
}

export function Icon({ name, size = 18, strokeWidth = 1.7, filled = false, title, ...rest }: IconProps): JSX.Element {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(PATHS) as IconName[];
