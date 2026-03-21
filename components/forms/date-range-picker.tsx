"use client"

import { format, startOfMonth, startOfQuarter, subMonths, subWeeks } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { DateRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

// Indian Financial Year: April 1 → March 31
function getCurrentFYStart(): Date {
  const now = new Date()
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return new Date(year, 3, 1) // April 1
}

function getFYLabel(startYear: number): string {
  return `FY ${startYear}-${String(startYear + 1).slice(2)}`
}

export function DateRangePicker({
  defaultDate,
  defaultRange = "all-time",
  onChange,
}: {
  defaultDate?: DateRange
  defaultRange?: string
  onChange?: (date: DateRange | undefined) => void
}) {
  const fyStart = getCurrentFYStart()
  const fyStartYear = fyStart.getFullYear()

  const predefinedRanges = [
    {
      code: "this-fy",
      label: getFYLabel(fyStartYear),
      range: { from: new Date(fyStartYear, 3, 1), to: new Date() },
    },
    {
      code: "last-fy",
      label: getFYLabel(fyStartYear - 1),
      range: { from: new Date(fyStartYear - 1, 3, 1), to: new Date(fyStartYear, 2, 31) },
    },
    {
      code: "q1-fy",
      label: "Q1 (Apr–Jun)",
      range: { from: new Date(fyStartYear, 3, 1), to: new Date(fyStartYear, 5, 30) },
    },
    {
      code: "q2-fy",
      label: "Q2 (Jul–Sep)",
      range: { from: new Date(fyStartYear, 6, 1), to: new Date(fyStartYear, 8, 30) },
    },
    {
      code: "q3-fy",
      label: "Q3 (Oct–Dec)",
      range: { from: new Date(fyStartYear, 9, 1), to: new Date(fyStartYear, 11, 31) },
    },
    {
      code: "q4-fy",
      label: "Q4 (Jan–Mar)",
      range: { from: new Date(fyStartYear + 1, 0, 1), to: new Date(fyStartYear + 1, 2, 31) },
    },
    {
      code: "last-4-weeks",
      label: "Last 4 weeks",
      range: { from: subWeeks(new Date(), 4), to: new Date() },
    },
    {
      code: "last-12-months",
      label: "Last 12 months",
      range: { from: subMonths(new Date(), 12), to: new Date() },
    },
    {
      code: "month-to-date",
      label: "Month to date",
      range: { from: startOfMonth(new Date()), to: new Date() },
    },
    {
      code: "quarter-to-date",
      label: "Quarter to date",
      range: { from: startOfQuarter(new Date()), to: new Date() },
    },
    {
      code: "all-time",
      label: "All time",
      range: { from: undefined, to: undefined },
    },
  ]

  const [rangeName, setRangeName] = useState<string>(defaultDate?.from ? "custom" : defaultRange)
  const [dateRange, setDateRange] = useState<DateRange | undefined>(defaultDate)

  useEffect(() => {
    if (!defaultDate?.from) {
      setRangeName(defaultRange)
      setDateRange(undefined)
    }
  }, [defaultDate, defaultRange])

  const getDisplayText = () => {
    if (rangeName === "custom") {
      if (dateRange?.from) {
        return dateRange.to
          ? `${format(dateRange.from, "LLL dd, y")} - ${format(dateRange.to, "LLL dd, y")}`
          : format(dateRange.from, "LLL dd, y")
      }
      return "Select dates"
    }
    return predefinedRanges.find((range) => range.code === rangeName)?.label || "Select dates"
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id="date"
          variant={"outline"}
          className={cn(
            "w-auto min-w-[130px] justify-start text-left font-normal",
            rangeName === "all-time" && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {getDisplayText()}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex flex-row gap-3 w-auto p-0" align="end">
        <div className="flex flex-col gap-3 p-3 border-r">
          {predefinedRanges.map(({ code, label }) => (
            <Button
              key={code}
              variant="ghost"
              className="justify-start pr-5"
              onClick={() => {
                setRangeName(code)
                const newDateRange = predefinedRanges.find((range) => range.code === code)?.range
                setDateRange(newDateRange)
                onChange?.(newDateRange)
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <Calendar
          initialFocus
          mode="range"
          defaultMonth={dateRange?.from}
          selected={dateRange}
          onSelect={(newDateRange) => {
            setRangeName("custom")
            setDateRange(newDateRange)
            onChange?.(newDateRange)
          }}
          numberOfMonths={2}
        />
      </PopoverContent>
    </Popover>
  )
}
