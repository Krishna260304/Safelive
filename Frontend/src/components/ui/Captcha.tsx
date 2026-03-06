import { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { Input } from './input';
import { Button } from './button';
import { cn } from '@/lib/utils';

interface CaptchaProps {
  value: string;
  onChange: (value: string) => void;
  onValidChange?: (isValid: boolean) => void;
  error?: string;
}

export const Captcha = ({ value, onChange, onValidChange, error }: CaptchaProps) => {
  const [num1, setNum1] = useState(0);
  const [num2, setNum2] = useState(0);
  const [operation, setOperation] = useState('+');
  const [isValid, setIsValid] = useState<boolean | null>(null);

  const generateNewCaptcha = useCallback(() => {
    const operations = ['+', '-', '*'];
    const nextOperation = operations[Math.floor(Math.random() * operations.length)];
    let nextNum1 = Math.floor(Math.random() * 10) + 1;
    let nextNum2 = Math.floor(Math.random() * 10) + 1;

    if (nextOperation === '-' && nextNum1 < nextNum2) {
      [nextNum1, nextNum2] = [nextNum2, nextNum1];
    }

    setNum1(nextNum1);
    setNum2(nextNum2);
    setOperation(nextOperation);
    onChange('');
    setIsValid(null);
  }, [onChange]);

  useEffect(() => {
    generateNewCaptcha();
  }, []);

  useEffect(() => {
    if (value === '') {
      setIsValid(null);
      onValidChange?.(false);
      return;
    }

    let correctAnswer = 0;
    if (operation === '+') {
      correctAnswer = num1 + num2;
    } else if (operation === '-') {
      correctAnswer = num1 - num2;
    } else if (operation === '*') {
      correctAnswer = num1 * num2;
    }

    const userAnswer = parseInt(value, 10);
    const valid = userAnswer === correctAnswer;
    setIsValid(valid);
    onValidChange?.(valid);
  }, [value, num1, num2, operation, onValidChange]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-4 py-2 bg-muted rounded-lg">
          <span className="font-mono text-lg font-semibold text-foreground">
            {num1} {operation} {num2} = ?
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={generateNewCaptcha}
          className="h-10 w-10 hover:bg-muted"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      <Input
        type="text"
        inputMode="numeric"
        placeholder="Enter answer"
        value={value}
        onChange={(e) => {
          const val = e.target.value.replace(/\D/g, '');
          if (val.length <= 3) {
            onChange(val);
          }
        }}
        className={cn(
          "w-32 transition-all duration-200",
          isValid === true && "border-success focus-visible:ring-success",
          isValid === false && "border-destructive focus-visible:ring-destructive"
        )}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {isValid === false && value !== '' && (
        <p className="text-sm text-destructive">Incorrect answer, please try again</p>
      )}
    </div>
  );
};
