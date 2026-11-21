/// <reference types="nativewind/types" />
import 'react-native';

// Explicit prop augmentation keeps TypeScript aligned with NativeWind's runtime
// className transform across React Native primitives.
declare module 'react-native' {
  interface ViewProps { className?: string; }
  interface TextProps { className?: string; }
  interface TextInputProps { className?: string; }
  interface PressableProps { className?: string; }
  interface ScrollViewProps { className?: string; }
  interface ImageProps { className?: string; }
  interface ImageBackgroundProps { className?: string; }
}
