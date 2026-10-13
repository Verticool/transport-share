import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { MapCanvas } from './map-canvas';

/**
 * Экран карты: слева карта парка, справа панель с легендой и списком самокатов.
 * Маркеры и список подключаются следующей задачей — сейчас проверяется сама карта.
 */
export function MapPage() {
  return (
    <div className="grid h-full grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="relative min-h-[420px] overflow-hidden rounded-xl border">
        <MapCanvas />
      </div>

      <aside className="flex flex-col gap-4" aria-label="Панель парка">
        <Card>
          <CardHeader>
            <CardTitle>Парк</CardTitle>
            <CardDescription>Самокаты поблизости появятся здесь</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Данных пока нет</CardContent>
        </Card>
      </aside>
    </div>
  );
}
