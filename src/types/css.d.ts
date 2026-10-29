/**
 * PropertyPro - CSS Module Type Declarations
 * Type declarations for CSS imports in TypeScript
 */

declare module "*.css" {
  const content: { [className: string]: string };
  export default content;
}

declare module "*.scss" {
  const content: { [className: string]: string };
  export default content;
}

declare module "*.sass" {
  const content: { [className: string]: string };
  export default content;
}

declare module "*.less" {
  const content: { [className: string]: string };
  export default content;
}

declare module "*.styl" {
  const content: { [className: string]: string };
  export default content;
}
