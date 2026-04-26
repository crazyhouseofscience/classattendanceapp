# K12 Scanner - Local Execution Guide

If you downloaded the ZIP file of this project and want to run it on your own computer, you cannot simply double-click the `index.html` file in your browser. This application uses modern web technologies (React, Vite) that require a local web server to run.

## Prerequisites

To run this application locally, you will need to install Node.js:
1. Go to [https://nodejs.org/](https://nodejs.org/)
2. Download and install the LTS (Long Term Support) version. 

## How to Run the App

1. Extract the downloaded ZIP file to a folder on your computer.
2. Open your computer's Terminal (Mac/Linux) or Command Prompt / PowerShell (Windows).
3. Navigate to the folder where you extracted the project. For example:
   ```bash
   cd path/to/extracted/folder
   ```
4. Install the required dependencies by running:
   ```bash
   npm install
   ```
5. Start the local development server by running:
   ```bash
   npm run dev
   ```
6. The terminal will display a local address (usually `http://localhost:5173`). Copy and paste this address into your web browser to view your app.

## Production Build

If you want to build the static files to host on your own server (or a service like GitHub Pages, Vercel, or Netlify):
```bash
npm run build
```
This will create a `dist` folder containing the optimized production application. You can use any static web server (like `npx serve -s dist`) to host these files.

## Privacy Note
This app stores data manually inside the browser you open it with. If you move from AI Studio to running locally, you must "Export" your data from the AI Studio app as a JSON file, and then "Import" (or restore contextually) in your local setup if you want to keep your data.
