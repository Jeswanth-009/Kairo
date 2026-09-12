import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps): IconProps {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    width: 18,
    height: 18,
    "aria-hidden": true,
    ...props,
  };
}

export function IconDashboard(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function IconVault(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3l7 2.6v5.2c0 4.6-3 7.6-7 9.2-4-1.6-7-4.6-7-9.2V5.6L12 3z" />
      <path d="M9.5 11.5l2 2 3.5-3.8" />
    </svg>
  );
}

export function IconJobs(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="7.5" width="18" height="12.5" rx="2" />
      <path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5" />
      <path d="M3 12.5h18" />
    </svg>
  );
}

export function IconResume(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 16.5h6" />
    </svg>
  );
}

export function IconApplications(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M21 3L11.5 12.5" />
      <path d="M21 3l-6.5 18-3.2-8.3L3 9.5 21 3z" />
    </svg>
  );
}

export function IconInterview(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3c-1.6 0-3.1-.4-4.4-1.1L3 20l1.3-4A8.3 8.3 0 1 1 21 11.5z" />
      <path d="M10.3 9.8a1.8 1.8 0 1 1 2.6 1.7c-.6.3-.9.7-.9 1.3v.3" />
      <path d="M12 15.8h.01" />
    </svg>
  );
}

export function IconSpark(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3l1.9 5.6a2 2 0 0 0 1.3 1.3L21 12l-5.8 2.1a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.6a2 2 0 0 0-1.3-1.3L3 12l5.8-2.1a2 2 0 0 0 1.3-1.3L12 3z" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6.5h16" />
      <path d="M4 12h16" />
      <path d="M4 17.5h16" />
      <circle cx="9.5" cy="6.5" r="2" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="7.5" cy="17.5" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
