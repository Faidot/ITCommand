"use client";

/**
 * Appearance preferences.
 *
 * These are per-person and per-browser, saved locally and applied instantly —
 * there is no Save button because every control takes effect as you press it,
 * and a preview you have to commit before seeing is not a preview.
 *
 * Each option says what it costs as well as what it does. "Reduce motion" that
 * silently also removed hover feedback would be a worse setting than one that
 * explains itself.
 */

import { useTheme } from "next-themes";
import {
  Contrast, Gauge, Monitor, Moon, MousePointerClick, RotateCcw,
  Sparkles, Sun, Type, Square,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_PREFS, Density, Hover, Motion, Radius, TextScale, useUiPrefs,
} from "@/store/uiPrefsStore";

/** A row of mutually exclusive choices. */
function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          title={o.hint}
          aria-pressed={value === o.value}
          className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
            value === o.value
              ? "border-primary bg-primary/10 font-medium text-primary"
              : "border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Setting({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b py-4 last:border-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <span className="mt-0.5 shrink-0 rounded-lg bg-muted p-2 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="shrink-0 sm:pl-4">{children}</div>
    </div>
  );
}

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const prefs = useUiPrefs();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Appearance
            </span>
            <Button variant="ghost" size="sm" onClick={prefs.reset}>
              <RotateCcw className="mr-2 h-4 w-4" /> Reset
            </Button>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Saved in this browser and applied straight away. They affect only
            what you see — nobody else&apos;s view changes.
          </p>
        </CardHeader>

        <CardContent className="pt-0">
          <Setting
            icon={theme === "dark" ? Moon : theme === "light" ? Sun : Monitor}
            title="Theme"
            description="Light, dark, or whatever the operating system is set to."
          >
            <Choice
              value={(theme as string) ?? "system"}
              onChange={setTheme}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "system", label: "System" },
              ]}
            />
          </Setting>

          <Setting
            icon={Gauge}
            title="Motion"
            description="Reduced keeps colour changes but stops things sliding and lifting. None removes animation entirely — the fastest option on older machines."
          >
            <Choice<Motion>
              value={prefs.motion}
              onChange={(v) => prefs.set("motion", v)}
              options={[
                { value: "full", label: "Full" },
                { value: "reduced", label: "Reduced" },
                { value: "none", label: "None" },
              ]}
            />
          </Setting>

          <Setting
            icon={MousePointerClick}
            title="Hover effects"
            description="Subtle drops the lift and glow on cards and table rows but keeps the colour change, so you can still tell what is clickable. Off removes hover feedback except in menus, where it is needed to see what you are about to pick."
          >
            <Choice<Hover>
              value={prefs.hover}
              onChange={(v) => prefs.set("hover", v)}
              options={[
                { value: "full", label: "Full" },
                { value: "subtle", label: "Subtle" },
                { value: "off", label: "Off" },
              ]}
            />
          </Setting>

          <Setting
            icon={Type}
            title="Text size"
            description="Scales the whole interface, spacing included — not just the words. Larger suits a wall display; smaller fits more on a laptop."
          >
            <Choice<TextScale>
              value={prefs.textScale}
              onChange={(v) => prefs.set("textScale", v)}
              options={[
                { value: "sm", label: "Small" },
                { value: "md", label: "Default" },
                { value: "lg", label: "Large" },
                { value: "xl", label: "Extra large" },
              ]}
            />
          </Setting>

          <Setting
            icon={Square}
            title="Density"
            description="Compact tightens table rows and card padding, so more fits on screen at once."
          >
            <Choice<Density>
              value={prefs.density}
              onChange={(v) => prefs.set("density", v)}
              options={[
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
              ]}
            />
          </Setting>

          <Setting
            icon={Square}
            title="Corners"
            description="How rounded cards, buttons and inputs are."
          >
            <Choice<Radius>
              value={prefs.radius}
              onChange={(v) => prefs.set("radius", v)}
              options={[
                { value: "round", label: "Rounded" },
                { value: "soft", label: "Soft" },
                { value: "square", label: "Square" },
              ]}
            />
          </Setting>

          <Setting
            icon={Sparkles}
            title="Background blur"
            description="The frosted-glass effect behind overlays and the top bar. The most expensive thing on screen for a weak graphics chip, and the first worth turning off if scrolling stutters."
          >
            <Switch checked={prefs.blur} onCheckedChange={(v) => prefs.set("blur", v)} />
          </Setting>

          <Setting
            icon={Contrast}
            title="Status colours"
            description="Green, amber and red on figures and badges. Turning this off leaves the wording and position to carry the meaning, which is steadier if you find the colour noisy or hard to distinguish."
          >
            <Switch
              checked={prefs.vividStatus}
              onCheckedChange={(v) => prefs.set("vividStatus", v)}
            />
          </Setting>

          <Setting
            icon={Gauge}
            title="Follow system reduce-motion"
            description="When your operating system asks for reduced motion, honour it even if Motion above is set to Full."
          >
            <Switch
              checked={prefs.followSystemMotion}
              onCheckedChange={(v) => prefs.set("followSystemMotion", v)}
            />
          </Setting>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Preview</CardTitle>
          <p className="text-sm text-muted-foreground">
            Hover and click these to feel the current settings.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Healthy", value: "98%", tone: "text-emerald-600" },
            { label: "Attention", value: "12", tone: "text-amber-600" },
            { label: "Overdue", value: "3", tone: "text-red-600" },
          ].map((s) => (
            <div
              key={s.label}
              className="cursor-pointer rounded-xl border bg-card p-4 transition-[box-shadow,border-color] hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
            >
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${s.tone}`}>{s.value}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="px-1 text-xs text-muted-foreground">
        Defaults: {DEFAULT_PREFS.motion} motion, {DEFAULT_PREFS.hover} hover,{" "}
        {DEFAULT_PREFS.density} density.
      </p>
    </div>
  );
}
