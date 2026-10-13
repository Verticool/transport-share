import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';

/** Кабинет: текущая поездка, история, входящие — стадии S5–S6. */
export function AccountPage() {
  return (
    <div className="p-4">
      <Card>
        <CardHeader>
          <CardTitle>Кабинет</CardTitle>
          <CardDescription>Текущая поездка, счета и письма появятся здесь</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Вы не вошли в аккаунт</CardContent>
      </Card>
    </div>
  );
}
