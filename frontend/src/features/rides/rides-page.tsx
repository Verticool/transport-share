import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';

/** История поездок: наполняется на стадии S6. */
export function RidesPage() {
  return (
    <div className="p-4">
      <Card>
        <CardHeader>
          <CardTitle>Поездки</CardTitle>
          <CardDescription>История поездок и счета появятся здесь</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Пока пусто</CardContent>
      </Card>
    </div>
  );
}
