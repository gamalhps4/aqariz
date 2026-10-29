"use client";

import { useEffect } from "react";
import {
  AlertTriangle,
  RefreshCw,
  Home,
} from "lucide-react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // Log critical error
    console.error("Critical Application Error:", {
      message: error.message,
      stack: error.stack,
      digest: error.digest,
      timestamp: new Date().toISOString(),
    });

    // In production, send to error monitoring service
    if (process.env.NODE_ENV === "production") {
      // TODO: Send to error monitoring service (e.g., Sentry, LogRocket)
      try {
        // Example: Sentry.captureException(error);
      } catch (e) {
        console.error("Failed to log error to monitoring service:", e);
      }
    }
  }, [error]);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Critical Error - PropertyPro</title>
        <style>{`
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1rem;
            color: #1f2937;
          }
          
          .container {
            background: white;
            border-radius: 1rem;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
            max-width: 42rem;
            width: 100%;
            overflow: hidden;
          }
          
          .header {
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            padding: 2rem;
            text-align: center;
            color: white;
          }
          
          .icon-container {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 5rem;
            height: 5rem;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 50%;
            margin-bottom: 1rem;
          }
          
          .icon {
            width: 3rem;
            height: 3rem;
          }
          
          .header h1 {
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
          }
          
          .header p {
            font-size: 1rem;
            opacity: 0.95;
          }
          
          .content {
            padding: 2rem;
          }
          
          .alert {
            background: #fef2f2;
            border: 1px solid #fecaca;
            border-radius: 0.5rem;
            padding: 1rem;
            margin-bottom: 1.5rem;
          }
          
          .alert-title {
            font-weight: 600;
            color: #991b1b;
            margin-bottom: 0.5rem;
          }
          
          .alert-description {
            color: #7f1d1d;
            font-size: 0.875rem;
            line-height: 1.5;
          }
          
          .error-details {
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 0.5rem;
            padding: 1rem;
            margin-bottom: 1.5rem;
          }
          
          .error-details summary {
            cursor: pointer;
            font-weight: 500;
            color: #4b5563;
            user-select: none;
          }
          
          .error-details summary:hover {
            color: #1f2937;
          }
          
          .error-code {
            background: #1f2937;
            color: #f3f4f6;
            padding: 1rem;
            border-radius: 0.375rem;
            font-family: 'Courier New', monospace;
            font-size: 0.75rem;
            overflow-x: auto;
            margin-top: 0.75rem;
            white-space: pre-wrap;
            word-break: break-all;
          }
          
          .actions {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
            margin-bottom: 1.5rem;
          }
          
          @media (min-width: 640px) {
            .actions {
              flex-direction: row;
            }
          }
          
          .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            padding: 0.75rem 1.5rem;
            border-radius: 0.5rem;
            font-weight: 500;
            font-size: 0.875rem;
            cursor: pointer;
            transition: all 0.2s;
            text-decoration: none;
            border: none;
            flex: 1;
          }
          
          .btn-primary {
            background: #667eea;
            color: white;
          }
          
          .btn-primary:hover {
            background: #5568d3;
          }
          
          .btn-secondary {
            background: #f3f4f6;
            color: #1f2937;
            border: 1px solid #d1d5db;
          }
          
          .btn-secondary:hover {
            background: #e5e7eb;
          }
          
          .footer {
            border-top: 1px solid #e5e7eb;
            padding: 1.5rem 2rem;
            text-align: center;
          }
          
          .footer-title {
            font-size: 0.875rem;
            color: #6b7280;
            margin-bottom: 0.75rem;
          }
          
          .footer-links {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
            justify-content: center;
          }
          
          .footer-link {
            font-size: 0.75rem;
            color: #667eea;
            text-decoration: none;
            padding: 0.25rem 0.75rem;
          }
          
          .footer-link:hover {
            text-decoration: underline;
          }
          
          .error-ref {
            text-align: center;
            margin-top: 1rem;
            font-size: 0.75rem;
            color: #6b7280;
          }
          
          .error-ref code {
            background: #f3f4f6;
            padding: 0.125rem 0.375rem;
            border-radius: 0.25rem;
            font-family: 'Courier New', monospace;
          }
        `}</style>
      </head>
      <body>
        <div className="container">
          <div className="header">
            <div className="icon-container">
              <AlertTriangle className="icon" />
            </div>
            <h1>Critical Application Error</h1>
            <p>We encountered a critical error that prevented the application from loading</p>
          </div>

          <div className="content">
            <div className="alert">
              <div className="alert-title">What happened?</div>
              <div className="alert-description">
                A critical error occurred in the application's core system. This is usually
                caused by a configuration issue, network problem, or temporary server error.
              </div>
            </div>

            {process.env.NODE_ENV === "development" && (
              <div className="error-details">
                <details>
                  <summary>Technical Details (Development Mode)</summary>
                  <div className="error-code">
                    <div><strong>Error Message:</strong></div>
                    <div>{error.message}</div>
                    {error.digest && (
                      <>
                        <div style={{ marginTop: '0.5rem' }}><strong>Error Digest:</strong></div>
                        <div>{error.digest}</div>
                      </>
                    )}
                    {error.stack && (
                      <>
                        <div style={{ marginTop: '0.5rem' }}><strong>Stack Trace:</strong></div>
                        <div>{error.stack}</div>
                      </>
                    )}
                  </div>
                </details>
              </div>
            )}

            {process.env.NODE_ENV === "production" && error.digest && (
              <div className="error-ref">
                <p>Error Reference: <code>{error.digest}</code></p>
                <p style={{ marginTop: '0.25rem' }}>
                  Please include this reference when contacting support.
                </p>
              </div>
            )}

            <div className="actions">
              <button onClick={() => reset()} className="btn btn-primary">
                <RefreshCw style={{ width: '1rem', height: '1rem' }} />
                Try Again
              </button>
              {/* global-error replaces the root layout, <html> and all. A
                  full reload is the only way back to a working document, so
                  the anchor is deliberate. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" className="btn btn-secondary">
                <Home style={{ width: '1rem', height: '1rem' }} />
                Go to Homepage
              </a>
            </div>

            <div className="footer">
              <div className="footer-title">Need immediate assistance?</div>
              {/* Only destinations that exist: there is no /docs page and no
                  status site, and the support address was a placeholder. */}
              <div className="footer-links">
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a href="/contact" className="footer-link">
                  Contact Support
                </a>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}

