import React from 'react';
import { Image } from 'react-native';

export default function BunaLogo({ size = 44 }: { size?: number }) {
  return (
    <Image
      source={require('../logo.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel="BunaLens logo"
    />
  );
}
