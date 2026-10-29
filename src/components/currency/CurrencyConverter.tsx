"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils/formatting";
import { ArrowRightLeft, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface CurrencyConverterProps {
  className?: string;
  defaultAmount?: number;
  showRates?: boolean;
}

export default function CurrencyConverter({
  className,
  defaultAmount = 1000,
  showRates = true,
}: CurrencyConverterProps) {
  const localization = useLocalizationContext();
  const [amount, setAmount] = useState(defaultAmount);
  const [fromCurrency, setFromCurrency] = useState(localization.currentCurrency);
  const [toCurrency, setToCurrency] = useState("USD");
  const [convertedAmount, setConvertedAmount] = useState(0);
  const [loading, setLoading] = useState(false);

  // Popular currency pairs for quick conversion
  const popularPairs = [
    { from: "USD", to: "EUR", label: "USD → EUR" },
    { from: "USD", to: "GBP", label: "USD → GBP" },
    { from: "EUR", to: "USD", label: "EUR → USD" },
    { from: "GBP", to: "USD", label: "GBP → USD" },
    { from: "USD", to: "CAD", label: "USD → CAD" },
    { from: "USD", to: "AUD", label: "USD → AUD" },
  ];

  // Mock exchange rates for display
  const mockRates = [
    { from: "USD", to: "EUR", rate: 0.85, change: 0.02 },
    { from: "USD", to: "GBP", rate: 0.73, change: -0.01 },
    { from: "USD", to: "CAD", rate: 1.25, change: 0.03 },
    { from: "USD", to: "AUD", rate: 1.35, change: 0.01 },
    { from: "USD", to: "JPY", rate: 110.25, change: -0.5 },
    { from: "EUR", to: "GBP", rate: 0.86, change: 0.01 },
  ];

  useEffect(() => {
    if (fromCurrency !== toCurrency) {
      const converted = localization.convertCurrency(amount, fromCurrency, toCurrency);
      setConvertedAmount(converted);
    } else {
      setConvertedAmount(amount);
    }
  }, [amount, fromCurrency, toCurrency, localization]);

  const handleSwapCurrencies = () => {
    setFromCurrency(toCurrency);
    setToCurrency(fromCurrency);
  };

  const handleQuickConvert = (from: string, to: string) => {
    setFromCurrency(from);
    setToCurrency(to);
  };

  const handleRefreshRates = async () => {
    setLoading(true);
    try {
      // In a real implementation, this would fetch fresh exchange rates
      await new Promise(resolve => setTimeout(resolve, 1000));
      // Update rates here
    } catch (error) {
      console.error("Failed to refresh rates:", error);
    } finally {
      setLoading(false);
    }
  };

  const getRateChange = (from: string, to: string) => {
    const rate = mockRates.find(r => r.from === from && r.to === to);
    return rate?.change || 0;
  };

  const formatRateChange = (change: number) => {
    const isPositive = change > 0;
    const Icon = isPositive ? TrendingUp : TrendingDown;
    const color = isPositive ? "text-green-600" : "text-red-600";
    
    return (
      <div className={`flex items-center gap-1 ${color}`}>
        <Icon className="h-3 w-3" />
        <span className="text-xs">
          {isPositive ? "+" : ""}{(change * 100).toFixed(2)}%
        </span>
      </div>
    );
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Main Converter */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Currency Converter
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshRates}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </CardTitle>
          <CardDescription>
            Convert between different currencies with real-time rates
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Amount Input */}
          <div className="space-y-2">
            <Label htmlFor="amount">Amount</Label>
            <Input
              id="amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder="Enter amount"
              className="text-lg"
            />
          </div>

          {/* Currency Selection */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-2">
              <Label htmlFor="from-currency">From</Label>
              <Select value={fromCurrency} onValueChange={setFromCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {localization.allCurrencies.map((currency) => (
                    <SelectItem key={currency.code} value={currency.code}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono">{currency.symbol}</span>
                        <span>{currency.code}</span>
                        <span className="text-muted-foreground">{currency.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSwapCurrencies}
                className="h-10 w-10 p-0"
              >
                <ArrowRightLeft className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="to-currency">To</Label>
              <Select value={toCurrency} onValueChange={setToCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {localization.allCurrencies.map((currency) => (
                    <SelectItem key={currency.code} value={currency.code}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono">{currency.symbol}</span>
                        <span>{currency.code}</span>
                        <span className="text-muted-foreground">{currency.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Conversion Result */}
          <div className="p-4 bg-muted rounded-lg">
            <div className="text-center space-y-2">
              <div className="text-2xl font-bold">
                {formatCurrency(convertedAmount, toCurrency)}
              </div>
              <div className="text-sm text-muted-foreground">
                {formatCurrency(amount, fromCurrency)} = {formatCurrency(convertedAmount, toCurrency)}
              </div>
              {fromCurrency !== toCurrency && (
                <div className="flex items-center justify-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    1 {fromCurrency} = {formatCurrency(
                      localization.convertCurrency(1, fromCurrency, toCurrency),
                      toCurrency,
                      { minimumFractionDigits: 4, maximumFractionDigits: 4 }
                    )}
                  </span>
                  {formatRateChange(getRateChange(fromCurrency, toCurrency))}
                </div>
              )}
            </div>
          </div>

          {/* Quick Conversion Buttons */}
          <div className="space-y-2">
            <Label>Quick Convert</Label>
            <div className="flex flex-wrap gap-2">
              {popularPairs.map((pair) => (
                <Button
                  key={`${pair.from}-${pair.to}`}
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickConvert(pair.from, pair.to)}
                  className="text-xs"
                >
                  {pair.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Exchange Rates Table */}
      {showRates && (
        <Card>
          <CardHeader>
            <CardTitle>Current Exchange Rates</CardTitle>
            <CardDescription>
              Live exchange rates updated every 15 minutes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {mockRates.map((rate) => (
                <div
                  key={`${rate.from}-${rate.to}`}
                  className="flex items-center justify-between p-3 rounded-lg border"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">{rate.from}</Badge>
                    <ArrowRightLeft className="h-3 w-3 text-muted-foreground" />
                    <Badge variant="outline">{rate.to}</Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-medium">
                      {rate.rate.toFixed(rate.to === "JPY" ? 2 : 4)}
                    </span>
                    {formatRateChange(rate.change)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
