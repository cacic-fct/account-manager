import { HtmlResponseService } from './html-response.service';

describe('HtmlResponseService', () => {
  const service = new HtmlResponseService();

  it('never treats a broad success phrase in HTML as identity proof', () => {
    expect(service.handleHtmlResponse('<html>Documento válido com sucesso</html>')).toEqual({
      success: false,
      error: 'Resposta inesperada do servidor da universidade.',
      fallbackToManual: false,
    });
  });

  it('classifies security-code wording changes as a retryable CAPTCHA error', () => {
    expect(
      service.handleHtmlResponse('<div class="errormsg">O código de segurança informado é inválido.</div>'),
    ).toMatchObject({
      success: false,
      needsNewCaptcha: true,
      error: 'Captcha incorreto',
    });
  });

  it('does not mistake ordinary CAPTCHA form labels for a provider validation error', () => {
    expect(
      service.handleHtmlResponse(
        '<form><label>Código de segurança</label><input name="txt_codigo_captcha"><p>Digite o código</p></form>',
      ),
    ).toEqual({
      success: false,
      error: 'Resposta inesperada do servidor da universidade.',
      fallbackToManual: false,
    });
  });

  it('matches the live provider CAPTCHA error element', () => {
    expect(service.handleHtmlResponse('<div class="errormsg">Código de segurança está inválido</div>')).toMatchObject({
      success: false,
      needsNewCaptcha: true,
      error: 'Captcha incorreto',
    });
  });
});
