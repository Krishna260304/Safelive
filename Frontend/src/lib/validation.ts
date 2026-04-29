import { z } from 'zod';



export const emailSchema = z
  .string()
  .trim()
  .min(1, { message: "Email is required" })
  .email({ message: "Please enter a valid email address" })
  .max(255, { message: "Email must be less than 255 characters" });

const optionalEmailSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z
    .string()
    .email({ message: "Please enter a valid email address" })
    .max(255, { message: "Email must be less than 255 characters" })
    .optional()
);



export const phoneSchema = z
  .string()
  .trim()
  .min(1, { message: "Phone number is required" })
  .regex(/^[6-9]\d{9}$/, { message: "Please enter a valid 10-digit mobile number" });



export const passwordSchema = z
  .string()
  .min(8, { message: "Password must be at least 8 characters" })
  .max(128, { message: "Password must be less than 128 characters" })
  .regex(/[A-Z]/, { message: "Password must contain at least one uppercase letter" })
  .regex(/[a-z]/, { message: "Password must contain at least one lowercase letter" })
  .regex(/[0-9]/, { message: "Password must contain at least one number" })
  .regex(/[^A-Za-z0-9]/, { message: "Password must contain at least one special character" });



export const nameSchema = z
  .string()
  .trim()
  .min(2, { message: "Name must be at least 2 characters" })
  .max(100, { message: "Name must be less than 100 characters" })
  .regex(/^[a-zA-Z\s'-]+$/, { message: "Name can only contain letters, spaces, hyphens and apostrophes" });

export const emailLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { message: "Password is required" }),
  captcha: z.string().min(1, { message: "Please solve the captcha" }),
});

export const phoneLoginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, { message: "Password is required" }),
  captcha: z.string().min(1, { message: "Please solve the captcha" }),
});

export const registrationSchema = z.object({
  fullName: nameSchema,
  email: optionalEmailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  confirmPassword: z.string(),
  address: z.string().trim().min(10, { message: "Please enter a complete address" }).max(500),
  pincode: z.string().regex(/^\d{6}$/, { message: "Please enter a valid 6-digit pincode" }),
  userType: z.enum(['local', 'official'], { required_error: "Please select user type" }),
  officialRole: z.enum(['department', 'worker']).optional(),
  workerSpecialization: z.string().trim().optional(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
}).refine((data) => {
  if (data.userType !== 'official') {
    return true;
  }
  return !!data.officialRole;
}, {
  message: "Please select official role",
  path: ["officialRole"],
}).refine((data) => {
  const needsEmail = data.userType === 'local' || (data.userType === 'official' && data.officialRole !== 'worker');
  if (!needsEmail) {
    return true;
  }
  return !!data.email;
}, {
  message: "Email is required",
  path: ["email"],
}).refine((data) => {
  if (data.userType !== 'official' || data.officialRole !== 'worker') {
    return true;
  }
  return !!(data.workerSpecialization && data.workerSpecialization.trim().length > 0);
}, {
  message: "Please select worker specialization",
  path: ["workerSpecialization"],
});

export const forgotPasswordEmailSchema = z.object({
  email: emailSchema,
});

export const forgotPasswordPhoneSchema = z.object({
  phone: phoneSchema,
});

export const otpSchema = z
  .string()
  .length(6, { message: "OTP must be 6 digits" })
  .regex(/^\d{6}$/, { message: "OTP must contain only numbers" });

export const resetPasswordSchema = z.object({
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export type EmailLoginFormData = z.infer<typeof emailLoginSchema>;
export type PhoneLoginFormData = z.infer<typeof phoneLoginSchema>;
export type RegistrationFormData = z.infer<typeof registrationSchema>;
export type ForgotPasswordEmailData = z.infer<typeof forgotPasswordEmailSchema>;
export type ForgotPasswordPhoneData = z.infer<typeof forgotPasswordPhoneSchema>;
export type ResetPasswordData = z.infer<typeof resetPasswordSchema>;
