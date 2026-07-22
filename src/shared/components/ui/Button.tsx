import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'dense';
  isLoading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  icon,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 disabled:cursor-not-allowed disabled:opacity-50 select-none';

  const variants = {
    primary:
      'border border-transparent bg-system-blue-solid text-white shadow-sm hover:bg-system-blue-hover active:bg-system-blue-active',
    secondary:
      'border border-border-black bg-panel-bg text-text-primary shadow-sm hover:bg-element-hover active:bg-element-active',
    ghost:
      'border border-transparent bg-transparent text-text-secondary hover:bg-element-hover active:bg-element-active',
    danger:
      'border border-transparent bg-danger text-white shadow-sm hover:bg-danger-hover active:bg-danger-active',
  };

  const sizes = {
    xs: 'gap-1 rounded-md px-2 py-0.5 text-[11px]',
    sm: 'gap-1.5 rounded-md px-2.5 py-1 text-xs',
    md: 'gap-2 rounded-lg px-4 py-1.5 text-sm',
    lg: 'gap-2.5 rounded-lg px-5 py-2.5 text-base',
    icon: 'rounded-md p-1.5',
    dense: 'h-[22px] gap-1 rounded-md px-1.5 text-[10px]',
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && (
        <svg
          className="-ml-1 mr-2 h-4 w-4 animate-spin text-current"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      {!isLoading && icon && <span className="flex items-center justify-center">{icon}</span>}
      {children}
    </button>
  );
};
