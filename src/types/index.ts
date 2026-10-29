/**
 * Re-export shim: the domain types moved to the shared contracts package so
 * the mobile app and any future standalone backend consume the exact same
 * definitions. App code keeps importing from "@/types".
 */
export * from "@propertypro/contracts";
