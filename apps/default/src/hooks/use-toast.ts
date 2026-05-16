import { toast } from "sonner"

/**
 * Compatibility shim: LLMs often generate shadcn/ui's useToast pattern.
 * This bridges to Sonner which is the actual toast library in base-template-v2.
 *
 * Preferred usage: import { toast } from "sonner" directly.
 */
export function useToast() {
  return {
    toast,
    dismiss: toast.dismiss,
  }
}

export { toast }
