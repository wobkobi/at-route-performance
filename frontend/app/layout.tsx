// frontend/app/layout.tsx
import "../styles/globals.css";
import type {ReactNode} from "react";
import "leaflet/dist/leaflet.css";

export const metadata = {
  title: "Auckland PT Router",
};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning style={{margin: 0, height: "100%"}}>
        {children}
      </body>
    </html>
  );
}
