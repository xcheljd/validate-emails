# Product Guidelines

## Visual Aesthetic & Tone
* **Professional & Clean:** The interface will prioritize data clarity and ease of use, leveraging the professional look of **Shadcn UI** components.
* **Color Palette:** The UI will be themed using a combination of **Dayfox** (for light mode/primary surfaces) and **Nordfox** (for dark mode/accents) from the Nightfox palette, ensuring a sophisticated, high-legibility experience.
* **Tone:** Helpful, efficient, and data-driven, reflecting the needs of sales professionals.

## User Interface Patterns
* **Validation Progress:** 
    * A real-time **Progress Bar** will be visible during bulk processing.
    * **Status Indicators** (counters) will show processing stats (e.g., "45/100 Processed", "12 Invalid Found") in the header or sidebar.
* **Navigation:** A sidebar-driven layout to switch between the "Upload/Input" area, the "Dashboard", and the "Detailed Inspection" table.

## Interaction Design
* **Smart Input:** The text field will automatically clean and split input based on commas or new lines, providing immediate feedback on the number of emails detected before the user starts validation.
* **Drill-down:** Clicking on any email in the results table will open a detailed side panel or modal showing the full SMTP handshake logs.
