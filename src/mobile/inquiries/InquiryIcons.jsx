import React from 'react';

// Talepler ekranlarının çizgi ikonları (canvas'takiyle aynı çizimler).
function Svg({ size = 20, strokeWidth = 1.75, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const InqIcon = {
  Inbox: (p) => (
    <Svg {...p}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </Svg>
  ),
  Ticket: (p) => (
    <Svg {...p}>
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M13 5v2M13 11v2M13 17v2" />
    </Svg>
  ),
  Person: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="8" r="4.5" />
      <path d="M20 21a8 8 0 0 0-16 0" />
    </Svg>
  ),
  Bubble: (p) => (
    <Svg {...p}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Svg>
  ),
  Shield: (p) => (
    <Svg {...p}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M12 8v4M12 16h.01" />
    </Svg>
  ),
  Check: (p) => (
    <Svg strokeWidth={2.2} {...p}>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  ),
  ChevronL: (p) => (
    <Svg strokeWidth={2} {...p}>
      <path d="m15 18-6-6 6-6" />
    </Svg>
  ),
  ChevronR: (p) => (
    <Svg strokeWidth={2} {...p}>
      <path d="m9 18 6-6-6-6" />
    </Svg>
  ),
  More: ({ size = 22, ...rest }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...rest}>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  ),
  Phone: (p) => (
    <Svg strokeWidth={2} {...p}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </Svg>
  ),
  Chat: (p) => (
    <Svg strokeWidth={2} {...p}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </Svg>
  ),
  Mail: (p) => (
    <Svg strokeWidth={2} {...p}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </Svg>
  ),
  Copy: (p) => (
    <Svg strokeWidth={2} {...p}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Svg>
  ),
  UserCheck: (p) => (
    <Svg strokeWidth={2} {...p}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="m16 11 2 2 4-4" />
    </Svg>
  ),
  Info: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </Svg>
  ),
};

export function KindIcon({ kind, size = 19 }) {
  if (kind === 'camp') return <InqIcon.Ticket size={size} />;
  if (kind === 'lesson') return <InqIcon.Person size={size} />;
  return <InqIcon.Bubble size={size} />;
}
