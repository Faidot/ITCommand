"use client"

interface BlobProps {
  variant?: "default" | "sidebar"
}

export function BackgroundBlobs({ variant = "default" }: BlobProps) {
  if (variant === "sidebar") {
    return (
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden opacity-100">
        <div
          className="absolute top-[5%] left-[-20%] w-[100px] h-[100px] rounded-full animate-float-slow"
          style={{ background: "radial-gradient(circle, rgba(168,85,247,0.3), transparent 50%)", filter: "blur(50px)" }}
        />
        <div
          className="absolute top-[25%] right-[-10%] w-[80px] h-[80px] rounded-full animate-float-slow-reverse"
          style={{ background: "radial-gradient(circle, rgba(236,72,153,0.25), transparent 70%)", filter: "blur(50px)", animationDelay: "2s" }}
        />
        <div
          className="absolute top-[50%] left-[10%] w-[90px] h-[90px] rounded-full animate-float-diagonal"
          style={{ background: "radial-gradient(circle, rgba(6,182,212,0.2), transparent 70%)", filter: "blur(35px)", animationDelay: "4s" }}
        />
        <div
          className="absolute bottom-[20%] right-[10%] w-[110px] h-[110px] rounded-full animate-float-slow"
          style={{ background: "radial-gradient(circle, rgba(99,91,255,0.25), transparent 70%)", filter: "blur(40px)", animationDelay: "1s" }}
        />
        <div
          className="absolute bottom-[5%] left-[-15%] w-[70px] h-[70px] rounded-full animate-float-slow-reverse"
          style={{ background: "radial-gradient(circle, rgba(244,63,94,0.15), transparent 70%)", filter: "blur(20px)", animationDelay: "3s" }}
        />
        {/* Grid Pattern Overlay */}
        <div
          className="absolute inset-0 opacity-[0.05] dark:opacity-[0.07]"
          style={{ backgroundImage: "radial-gradient(circle, hsl(var(--foreground)) 1px, transparent 1px)", backgroundSize: "16px 16px" }}
        />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      <div
        className="absolute top-[-15%] right-[-5%] w-[50%] h-[50%] rounded-full animate-float-slow"
        style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.15), rgba(99,91,255,0.1))", filter: "blur(80px)" }}
      />
      <div
        className="absolute bottom-[-15%] left-[10%] w-[45%] h-[45%] rounded-full animate-float-slow-reverse"
        style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.1), rgba(59,130,246,0.15))", filter: "blur(80px)" }}
      />
      <div
        className="absolute top-[30%] left-[25%] w-[35%] h-[35%] rounded-full animate-float-diagonal"
        style={{ background: "linear-gradient(135deg, rgba(245,158,11,0.1), rgba(236,72,153,0.1))", filter: "blur(70px)" }}
      />

      {/* Grid Pattern Overlay */}
      <div
        className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04]"
        style={{ backgroundImage: "radial-gradient(circle, hsl(var(--foreground)) 1px, transparent 1px)", backgroundSize: "24px 24px" }}
      />
    </div>
  )
}
