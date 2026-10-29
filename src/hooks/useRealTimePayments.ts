/**
 * PropertyPro - Real-time Payment Updates Hook
 * Provides real-time payment status updates using Server-Sent Events
 */

import { useState, useEffect, useRef } from "react";
import { IPayment } from "@/types";

interface PaymentUpdate {
  type: "payment_status_change" | "payment_created" | "payment_deleted";
  payment: IPayment;
  timestamp: string;
}

interface UseRealTimePaymentsOptions {
  tenantId?: string;
  leaseId?: string;
  propertyId?: string;
  enabled?: boolean;
}

interface UseRealTimePaymentsReturn {
  isConnected: boolean;
  lastUpdate: PaymentUpdate | null;
  connectionError: string | null;
  reconnect: () => void;
  disconnect: () => void;
}

export function useRealTimePayments(
  options: UseRealTimePaymentsOptions = {}
): UseRealTimePaymentsReturn {
  const { tenantId, leaseId, propertyId, enabled = true } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<PaymentUpdate | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  const buildStreamUrl = () => {
    const params = new URLSearchParams();

    if (tenantId) params.append("tenantId", tenantId);
    if (leaseId) params.append("leaseId", leaseId);
    if (propertyId) params.append("propertyId", propertyId);

    return `/api/payments/stream?${params.toString()}`;
  };

  const connect = () => {
    if (!enabled || eventSourceRef.current) return;

    try {
      const url = buildStreamUrl();

      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {

        setIsConnected(true);
        setConnectionError(null);
        reconnectAttempts.current = 0;
      };

      eventSource.onmessage = (event) => {
        try {
          const update: PaymentUpdate = JSON.parse(event.data);

          setLastUpdate(update);
        } catch (error) {
          console.error("Error parsing payment update:", error);
        }
      };

      eventSource.onerror = (error) => {
        console.error("Payment stream error:", error);
        setIsConnected(false);
        setConnectionError("Connection lost");

        // Attempt to reconnect with exponential backoff
        if (reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.pow(2, reconnectAttempts.current) * 1000; // 1s, 2s, 4s, 8s, 16s

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttempts.current++;
            disconnect();
            connect();
          }, delay);
        } else {
          setConnectionError("Failed to reconnect after multiple attempts");
        }
      };

      // Handle specific payment events
      eventSource.addEventListener("payment_status_change", (event) => {
        try {
          const update: PaymentUpdate = JSON.parse(event.data);
          setLastUpdate(update);
        } catch (error) {
          console.error("Error parsing payment status change:", error);
        }
      });

      eventSource.addEventListener("payment_created", (event) => {
        try {
          const update: PaymentUpdate = JSON.parse(event.data);
          setLastUpdate(update);
        } catch (error) {
          console.error("Error parsing payment created event:", error);
        }
      });

      eventSource.addEventListener("payment_deleted", (event) => {
        try {
          const update: PaymentUpdate = JSON.parse(event.data);
          setLastUpdate(update);
        } catch (error) {
          console.error("Error parsing payment deleted event:", error);
        }
      });
    } catch (error) {
      console.error("Error creating payment stream connection:", error);
      setConnectionError("Failed to establish connection");
    }
  };

  const disconnect = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setIsConnected(false);
  };

  const reconnect = () => {
    disconnect();
    reconnectAttempts.current = 0;
    setConnectionError(null);
    connect();
  };

  useEffect(() => {
    if (enabled) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, tenantId, leaseId, propertyId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  return {
    isConnected,
    lastUpdate,
    connectionError,
    reconnect,
    disconnect,
  };
}

// Hook for updating payment lists in real-time
export function usePaymentListUpdates(
  payments: IPayment[],
  setPayments: React.Dispatch<React.SetStateAction<IPayment[]>>,
  options: UseRealTimePaymentsOptions = {}
) {
  const { lastUpdate } = useRealTimePayments(options);

  useEffect(() => {
    if (!lastUpdate) return;

    const { type, payment } = lastUpdate;

    switch (type) {
      case "payment_status_change":
        setPayments((prev) =>
          prev.map((p) => (p._id === payment._id ? payment : p))
        );
        break;

      case "payment_created":
        setPayments((prev) => {
          // Check if payment already exists to avoid duplicates
          const exists = prev.some((p) => p._id === payment._id);
          if (!exists) {
            return [...prev, payment];
          }
          return prev;
        });
        break;

      case "payment_deleted":
        setPayments((prev) => prev.filter((p) => p._id !== payment._id));
        break;

      default:
        console.warn("Unknown payment update type:", type);
    }
  }, [lastUpdate, setPayments]);
}

// Hook for real-time payment summary updates
export function usePaymentSummaryUpdates(
  refreshSummary: () => Promise<void>,
  options: UseRealTimePaymentsOptions = {}
) {
  const { lastUpdate } = useRealTimePayments(options);

  useEffect(() => {
    if (lastUpdate) {
      // Refresh summary when any payment changes
      refreshSummary();
    }
  }, [lastUpdate, refreshSummary]);
}
