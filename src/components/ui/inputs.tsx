import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const BASE = [
  "w-full rounded-lg border bg-white px-3 py-2 text-sm text-ink shadow-sm",
  "placeholder:text-slate-400",
  "transition-colors duration-200",
  "focus:outline-none focus:ring-4 focus:ring-kairo-blue/10",
].join(" ");

function borderFor(error?: boolean) {
  return error
    ? "border-red-300 hover:border-red-400 focus:border-red-400"
    : "border-slate-200 hover:border-slate-300 focus:border-kairo-blue";
}

interface FieldProps {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}

export function Field({ label, required, error, hint, children }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-xs font-medium text-ink">
        <span>
          {label}
          {required ? <span className="ml-0.5 text-kairo-blue">*</span> : null}
        </span>
        {hint ? <span className="font-normal text-slate-400">{hint}</span> : null}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
    </label>
  );
}

export function Input({
  error,
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  return <input className={`${BASE} ${borderFor(error)} ${className}`} {...rest} />;
}

export function Textarea({
  error,
  className = "",
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean }) {
  return <textarea rows={4} className={`${BASE} ${borderFor(error)} ${className}`} {...rest} />;
}

export function Select({
  error,
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { error?: boolean }) {
  return (
    <select
      className={`${BASE} ${borderFor(error)} cursor-pointer appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")] bg-[length:12px] bg-[position:right_0.65rem_center] bg-no-repeat pr-8 ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 accent-kairo-blue"
      />
      {label}
    </label>
  );
}
