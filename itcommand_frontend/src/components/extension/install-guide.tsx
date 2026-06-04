"use client";

import { Globe, Download, Puzzle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORE_URL = process.env.NEXT_PUBLIC_EXTENSION_STORE_URL || "";
const ZIP_URL = "/it-command-extension.zip";

/**
 * Install instructions for the IT Command browser extension. If a Chrome Web
 * Store URL is configured it offers a one-click "Add to Chrome"; otherwise it
 * walks through the unpacked (developer) install with a zip download.
 */
export function ExtensionInstallGuide() {
  if (STORE_URL) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Add the IT Command extension to auto-fill your vault passwords in the browser.
        </p>
        <a href={STORE_URL} target="_blank" rel="noreferrer">
          <Button>
            <Globe className="w-4 h-4 mr-2" /> Add to Chrome
          </Button>
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        The extension isn&apos;t on the Chrome Web Store yet — install it as an unpacked extension.
        It takes about a minute.
      </p>

      <a href={ZIP_URL} download>
        <Button>
          <Download className="w-4 h-4 mr-2" /> Download extension (.zip)
        </Button>
      </a>

      <ol className="text-sm space-y-2 list-decimal pl-5 text-foreground/90">
        <li>Unzip the downloaded file to a folder you&apos;ll keep.</li>
        <li>
          Open <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs">chrome://extensions</code>{" "}
          (or <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs">edge://extensions</code>).
        </li>
        <li>Turn on <span className="font-medium">Developer mode</span> (top-right).</li>
        <li>
          Click <span className="font-medium">Load unpacked</span> and select the unzipped
          <span className="font-mono text-xs"> it-command-extension</span> folder.
        </li>
        <li>Pin the <span className="font-medium inline-flex items-center gap-1"><Puzzle className="w-3.5 h-3.5" /> IT Command</span> icon, then sign in and unlock the vault.</li>
      </ol>

      <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
        <ExternalLink className="w-3 h-3" />
        After installing, return here — this page will detect it automatically.
      </p>
    </div>
  );
}
