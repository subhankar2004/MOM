import { ComingSoon } from '@/components/coming-soon';

export default function HomePage() {
  return (
    <ComingSoon
      title="Stalls near you"
      issue={11}
      description="Every stall around campus with its open hours, how busy it is and what it accepts."
    />
  );
}
