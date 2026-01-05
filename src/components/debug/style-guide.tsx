import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const ColorSwatch = ({ name, className }: { name: string; className: string }) => (
  <div className="flex flex-col items-center gap-2">
    <div className={`h-16 w-16 rounded-md border shadow-sm ${className}`} />
    <span className="text-xs font-medium">{name}</span>
  </div>
);

export const StyleGuide = () => {
  return (
    <div className="container mx-auto space-y-8 p-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Design System Audit</h1>
        <p className="text-muted-foreground">
          Visual verification of the Dayfox/Nordfox theme implementation.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Color Palette</h2>
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
              <ColorSwatch name="Background" className="bg-background" />
              <ColorSwatch name="Foreground" className="bg-foreground" />
              <ColorSwatch name="Primary" className="bg-primary" />
              <ColorSwatch name="Primary Fg" className="bg-primary-foreground" />
              <ColorSwatch name="Secondary" className="bg-secondary" />
              <ColorSwatch name="Secondary Fg" className="bg-secondary-foreground" />
              <ColorSwatch name="Destructive" className="bg-destructive" />
              <ColorSwatch name="Destructive Fg" className="bg-destructive-foreground" />
              <ColorSwatch name="Muted" className="bg-muted" />
              <ColorSwatch name="Muted Fg" className="bg-muted-foreground" />
              <ColorSwatch name="Accent" className="bg-accent" />
              <ColorSwatch name="Accent Fg" className="bg-accent-foreground" />
              <ColorSwatch name="Card" className="bg-card" />
              <ColorSwatch name="Popover" className="bg-popover" />
              <ColorSwatch name="Border" className="bg-border" />
              <ColorSwatch name="Input" className="bg-input" />
              <ColorSwatch name="Ring" className="bg-ring" />
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Typography</h2>
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-2">
              <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl">
                Heading 1
              </h1>
              <h2 className="text-3xl font-semibold tracking-tight first:mt-0">
                Heading 2
              </h2>
              <h3 className="text-2xl font-semibold tracking-tight">Heading 3</h3>
              <h4 className="text-xl font-semibold tracking-tight">Heading 4</h4>
              <p className="leading-7 [&:not(:first-child)]:mt-6">
                The quick brown fox jumps over the lazy dog. (Body)
              </p>
              <p className="text-sm text-muted-foreground">
                The quick brown fox jumps over the lazy dog. (Small / Muted)
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Buttons</h2>
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4">
              <Button variant="default">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="link">Link</Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
};