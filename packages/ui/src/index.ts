export { cn } from "./lib/cn";
export { formatRatio, formatOccurredAt } from "./lib/format";

export { RatioBadge } from "./components/RatioBadge";
export type { RatioBadgeProps } from "./components/RatioBadge";

export { MacroBar } from "./components/MacroBar";
export type { MacroBarProps } from "./components/MacroBar";

export { WarningBanner } from "./components/WarningBanner";
export type {
  WarningBannerProps,
  WarningLevel,
} from "./components/WarningBanner";

export { DiaryEntryCard } from "./components/DiaryEntryCard";
export type { DiaryEntryCardProps } from "./components/DiaryEntryCard";

export { DataTable } from "./components/DataTable";
export type { DataTableProps, DataTableLabels } from "./components/DataTable";

export { TrendChart } from "./components/TrendChart";
export type {
  TrendChartProps,
  TrendPoint,
  PrescriptionMarker,
} from "./components/TrendChart";

/* --- shadcn/ui ---
 *
 * Кит переэкспортируется отсюда, чтобы у приложений был один вход:
 * `import { Button, Card } from "@ketocare/ui"`. Импортировать файлы кита
 * напрямую не нужно — иначе публичная граница пакета перестаёт существовать,
 * и Mini App на этапе 3 начнёт зависеть от его внутренней раскладки.
 */
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./components/ui/alert-dialog";
export { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
export {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "./components/ui/avatar";
export { Badge, badgeVariants } from "./components/ui/badge";
export { Button, buttonVariants } from "./components/ui/button";
export { Calendar, CalendarDayButton } from "./components/ui/calendar";
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "./components/ui/command";
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "./components/ui/dialog";
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
} from "./components/ui/form";
export { Input } from "./components/ui/input";
export { Label } from "./components/ui/label";
export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./components/ui/popover";
export { Progress } from "./components/ui/progress";
export { ScrollArea, ScrollBar } from "./components/ui/scroll-area";
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
export { Separator } from "./components/ui/separator";
export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./components/ui/sheet";
export { Skeleton } from "./components/ui/skeleton";
export { Toaster } from "./components/ui/sonner";
/* Всплывающие сообщения вызываются через toast() — приложениям не нужно знать,
   что под ним sonner. */
export { toast } from "sonner";
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table";
export {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  tabsListVariants,
} from "./components/ui/tabs";
export { Textarea } from "./components/ui/textarea";
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip";
