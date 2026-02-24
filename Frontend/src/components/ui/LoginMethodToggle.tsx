import { LoginMethod } from '@/types/auth';
import { Mail, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoginMethodToggleProps {
  selectedMethod: LoginMethod;
  onSelectMethod: (method: LoginMethod) => void;
}

export const LoginMethodToggle = ({ selectedMethod, onSelectMethod }: LoginMethodToggleProps) => {
  return (
    <div className="relative flex bg-muted p-1 rounded-lg">
      {}
      <div 
        className={cn(
          "absolute top-1 bottom-1 w-[calc(50%-4px)] bg-card rounded-md shadow-sm transition-transform duration-300 ease-out",
          selectedMethod === 'phone' && "translate-x-[calc(100%+8px)]"
        )}
      />
      
      <button
        type="button"
        onClick={() => onSelectMethod('email')}
        className={cn(
          "relative flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-sm font-medium transition-colors duration-200",
          selectedMethod === 'email' 
            ? "text-foreground" 
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Mail className="h-4 w-4" />
        <span>Email</span>
      </button>
      
      <button
        type="button"
        onClick={() => onSelectMethod('phone')}
        className={cn(
          "relative flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-sm font-medium transition-colors duration-200",
          selectedMethod === 'phone' 
            ? "text-foreground" 
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Phone className="h-4 w-4" />
        <span>Phone</span>
      </button>
    </div>
  );
};
