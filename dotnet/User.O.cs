
// Triggering User

internal class User_T : User
{
  public override
  string Name
  {
    get => NameMvcc.Value;
    set => NameMvcc.Value = value;
  }
  private readonly
  Mvcc<string> NameMvcc = new Mvcc<string>("");

  public override
  string Email
  {
    get => EmailMvcc.Value;
    set => EmailMvcc.Value = value;
  }
  private Mvcc<string> EmailMvcc = new Mvcc<string>("");

  public override
  DateTime Birthday
  {
    get => BirthdayMvcc.Value;
    set => BirthdayMvcc.Value = value;
  }
  private Mvcc<DateTime> BirthdayMvcc = new Mvcc<DateTime>(default);
}
