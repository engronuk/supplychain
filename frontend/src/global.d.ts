// global.d.ts
// Ambient declarations so .tsx files can import shadcn UI components
// (which live as .jsx without TS types) and other modules without friction.

declare module "@/components/ui/*" {
  const anything: any;
  export = anything;
}
declare module "@/components/ui/button" {
  export const Button: any;
}
declare module "@/components/ui/card" {
  export const Card: any;
  export const CardContent: any;
  export const CardHeader: any;
  export const CardTitle: any;
  export const CardDescription: any;
  export const CardFooter: any;
}
declare module "@/components/ui/sheet" {
  export const Sheet: any;
  export const SheetContent: any;
  export const SheetHeader: any;
  export const SheetTitle: any;
  export const SheetDescription: any;
  export const SheetFooter: any;
  export const SheetTrigger: any;
  export const SheetClose: any;
}
declare module "@/components/ui/dialog" {
  export const Dialog: any;
  export const DialogContent: any;
  export const DialogHeader: any;
  export const DialogTitle: any;
  export const DialogDescription: any;
  export const DialogFooter: any;
  export const DialogTrigger: any;
  export const DialogClose: any;
}
declare module "@/components/ui/input" {
  export const Input: any;
}
declare module "@/components/ui/label" {
  export const Label: any;
}
declare module "@/components/ui/textarea" {
  export const Textarea: any;
}
declare module "@/components/ui/select" {
  export const Select: any;
  export const SelectTrigger: any;
  export const SelectValue: any;
  export const SelectContent: any;
  export const SelectItem: any;
  export const SelectGroup: any;
  export const SelectLabel: any;
}
declare module "@/components/ui/tabs" {
  export const Tabs: any;
  export const TabsList: any;
  export const TabsTrigger: any;
  export const TabsContent: any;
}
declare module "@/components/ui/badge" {
  export const Badge: any;
}
declare module "@/components/ui/popover" {
  export const Popover: any;
  export const PopoverTrigger: any;
  export const PopoverContent: any;
}
declare module "@/components/ui/scroll-area" {
  export const ScrollArea: any;
  export const ScrollBar: any;
}
declare module "@/components/ui/sonner" {
  export const Toaster: any;
}
declare module "@/components/ui/table" {
  export const Table: any;
  export const TableHeader: any;
  export const TableBody: any;
  export const TableHead: any;
  export const TableRow: any;
  export const TableCell: any;
  export const TableFooter: any;
  export const TableCaption: any;
}
declare module "sonner" {
  export const toast: any;
  export const Toaster: any;
}
declare module "@/lib/api" {
  export const Api: any;
  const _default: any;
  export default _default;
}
declare module "@/components/StatusBadge" {
  export const StatusBadge: any;
}
