import { Check } from 'lucide-react';

interface ViewMenuItemProps {
  checked: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function ViewMenuItem({ checked, label, onClick, disabled = false }: ViewMenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitemcheckbox"
      aria-checked={checked}
      disabled={disabled}
      className="group flex w-full items-center justify-between px-3 py-2 text-left text-xs whitespace-nowrap text-text-primary transition-colors hover:bg-element-hover focus:outline-none focus-visible:bg-element-hover focus-visible:ring-2 focus-visible:ring-system-blue/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <div className="flex items-center gap-2">
        <div
          className={`flex h-4 w-4 items-center justify-center rounded border ${
            checked ? 'border-system-blue bg-system-blue text-white' : 'border-border-strong'
          }`}
        >
          {checked && <Check className="w-3 h-3" />}
        </div>
        <span>{label}</span>
      </div>
    </button>
  );
}
