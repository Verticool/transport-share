import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';

/**
 * Экран карты. Наполнение (OpenLayers, маркеры парка, зона) добавляется следующей задачей;
 * сейчас — контейнер и заголовок, чтобы каркас был проверяем и не пустовал.
 */
export function MapPage() {
  return (
    <div className="grid h-full grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div
        className="relative min-h-[420px] overflow-hidden rounded-xl border bg-muted"
        data-testid="map-container"
        role="region"
        aria-label="Карта самокатов"
      >
        <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          Здесь будет карта парка
        </div>
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
