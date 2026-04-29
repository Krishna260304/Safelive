import { LoginMethod } from '@/types/auth';
import { Mail, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoginMethodToggleProps {
  selectedMethod: LoginMethod;
  onSelectMethod: (method: LoginMethod) => void;
}

export const LoginMethodToggle = ({ selectedMethod, onSelectMethod }: LoginMethodToggleProps) => {
  return (
    <div className="relative flex rounded-lg bg-muted p-1">
      <div 
        className={cn(
          "pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-md bg-card shadow-sm transition-transform duration-300 ease-out",
          selectedMethod === 'phone' && "translate-x-[calc(100%+0.5rem)]"
        )}
      />
      
      <button
        type="button"
        onClick={() => onSelectMethod('email')}
        className={cn(
          "relative z-10 flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium leading-none transition-colors duration-200",
          selectedMethod === 'email' 
            ? "text-foreground" 
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Mail className="h-4 w-4 shrink-0" />
        <span className="leading-none">Email</span>
      </button>
      
      <button
        type="button"
        onClick={() => onSelectMethod('phone')}
        className={cn(
          "relative z-10 flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium leading-none transition-colors duration-200",
          selectedMethod === 'phone' 
            ? "text-foreground" 
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Phone className="h-4 w-4 shrink-0" />
        <span className="leading-none">Phone</span>
      </button>
    </div>
  );
};
