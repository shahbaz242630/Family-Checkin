import { Controller, Get, Headers, Inject, NotFoundException, Param, Patch, UnauthorizedException } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { AdminAuthService } from '../auth/admin-auth.service';
import { AdminAbuseService } from './admin-abuse.service';

const REVIEW_ROLES = [AdminRole.SUPER_ADMIN, AdminRole.OPERATOR];

@Controller('admin/abuse-reports')
export class AdminAbuseController {
  constructor(
    @Inject(AdminAuthService)
    private readonly adminAuthService: Pick<AdminAuthService, 'verifyAdminAccessToken'>,
    @Inject(AdminAbuseService)
    private readonly adminAbuseService: Pick<AdminAbuseService, 'listPendingReports' | 'getReport' | 'markSafe' | 'markActionTaken'>,
  ) {}

  @Get()
  async listPendingReports(@Headers('authorization') authorization: string | undefined) {
    const accessToken = this.getBearerToken(authorization);
    await this.adminAuthService.verifyAdminAccessToken(accessToken);

    return this.adminAbuseService.listPendingReports();
  }

  @Get(':abuseReportId')
  async getReport(
    @Headers('authorization') authorization: string | undefined,
    @Param('abuseReportId') abuseReportId: string,
  ) {
    const accessToken = this.getBearerToken(authorization);
    await this.adminAuthService.verifyAdminAccessToken(accessToken);

    const report = await this.adminAbuseService.getReport(abuseReportId);
    if (!report) {
      throw new NotFoundException('Abuse report not found');
    }

    return report;
  }

  @Patch(':abuseReportId/review-safe')
  async markSafe(
    @Headers('authorization') authorization: string | undefined,
    @Param('abuseReportId') abuseReportId: string,
  ) {
    const accessToken = this.getBearerToken(authorization);
    const admin = await this.adminAuthService.verifyAdminAccessToken(accessToken, REVIEW_ROLES);

    const report = await this.adminAbuseService.markSafe(abuseReportId, { adminId: admin.id });
    if (!report) {
      throw new NotFoundException('Pending abuse report not found');
    }

    return report;
  }

  @Patch(':abuseReportId/review-action-taken')
  async markActionTaken(
    @Headers('authorization') authorization: string | undefined,
    @Param('abuseReportId') abuseReportId: string,
  ) {
    const accessToken = this.getBearerToken(authorization);
    const admin = await this.adminAuthService.verifyAdminAccessToken(accessToken, REVIEW_ROLES);

    const report = await this.adminAbuseService.markActionTaken(abuseReportId, { adminId: admin.id });
    if (!report) {
      throw new NotFoundException('Pending abuse report not found');
    }

    return report;
  }

  private getBearerToken(authorization: string | undefined): string {
    const [scheme, token] = authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Bearer token is required');
    }

    return token;
  }
}
