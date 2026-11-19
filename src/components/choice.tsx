import type { ReactNode } from "react";

/** Radio row used by decision forms: 56px+ target, bold title, description always visible. */
export function Choice({
  name,
  checked,
  disabled = false,
  onChange,
  title,
  text,
}: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  title: ReactNode;
  text: string;
}) {
  return (
    <label
      className={`flex min-h-14 items-start gap-3 rounded-md border-2 p-3 ${
        checked ? "border-primary bg-primary-tint" : "border-rule bg-surface"
      } ${disabled ? "cursor-not-allowed opacity-75" : "cursor-pointer"}`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-1 size-5 shrink-0 accent-primary"
      />
      <span>
        <span className="block font-bold">{title}</span>
        <span className="block text-sm">{text}</span>
      </span>
    </label>
  );
}
