CASHBOOK FOR CONTRACTORS - LIVE DEMO (web version)
==================================================

What this is
  The real program running in the browser with sample data. Visitors can use every
  feature, but nothing is saved. Reset, refresh or closing the tab brings back the
  original data. The "Download full version" button opens your Google Drive folder.

How to publish
  Upload the CONTENTS of this folder (index.html, app/, demo/) to any web host:
  GitHub Pages, Netlify, Cloudflare Pages, or your own hosting (public_html).
  Open the address of index.html. It must be served over http(s); opening
  index.html by double-click will not work (browsers block it).

  Quick local test (needs Python):  python -m http.server 8000
  then open http://localhost:8000

Where things are
  index.html            demo page (top bar, Reset button, Download button)
  demo/seed.js          sample clients, projects, payroll, POs, cheques, HR files
  demo/shim.js          in-memory storage that replaces the desktop database
  demo/print-bridge.js  builds the PDF for Print Preview inside the browser
  app/                  the program itself (from CB-Contractors-1.9-Source)

Change the download link
  Search index.html for "drive.google.com" (two places).
