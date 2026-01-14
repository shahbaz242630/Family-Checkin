// Avatar component - displays user initials or image
import { View, Text, Image, StyleSheet } from 'react-native';
import { colors, fontSize } from '../../theme';

interface AvatarProps {
  name?: string;
  imageUrl?: string;
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = {
  sm: { container: 32, text: fontSize.sm },
  md: { container: 40, text: fontSize.md },
  lg: { container: 56, text: fontSize.lg },
};

function getInitials(name: string): string {
  const parts = name.trim().split(' ');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function getColorFromName(name: string): string {
  const colors = ['#4F46E5', '#7C3AED', '#DB2777', '#DC2626', '#EA580C', '#16A34A', '#0891B2'];
  const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[index % colors.length];
}

export function Avatar({ name = '', imageUrl, size = 'md' }: AvatarProps) {
  const dimensions = SIZES[size];
  const initials = getInitials(name || '?');
  const bgColor = getColorFromName(name || 'default');

  if (imageUrl) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={[
          styles.image,
          { width: dimensions.container, height: dimensions.container, borderRadius: dimensions.container / 2 },
        ]}
      />
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          width: dimensions.container,
          height: dimensions.container,
          borderRadius: dimensions.container / 2,
          backgroundColor: bgColor,
        },
      ]}
    >
      <Text style={[styles.initials, { fontSize: dimensions.text }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  image: {
    backgroundColor: colors.border,
  },
});
