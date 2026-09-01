import { TrimText } from '../common/trim-text';
import { Type, Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { MODULES, ROLE_DEFAULTS } from '../access/permission-policy';

export class PermissionOverrideDto {
  @IsIn(MODULES) module!: typeof MODULES[number];
  @IsIn(['VIEW', 'EDIT', 'MANAGE']) level!: 'VIEW' | 'EDIT' | 'MANAGE';
  @IsIn(['ALLOW', 'DENY']) effect!: 'ALLOW' | 'DENY';
}
export class AssignmentDto {
  @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsIn(Object.keys(ROLE_DEFAULTS), { each: true })
  roleCodes!: string[];
  @IsArray() @ArrayMaxSize(MODULES.length) @ValidateNested({ each: true }) @Type(() => PermissionOverrideDto)
  overrides!: PermissionOverrideDto[];
}
export class VersionDto { @IsInt() @Min(1) version!: number; }
export class PermissionsDto extends AssignmentDto { @IsInt() @Min(1) version!: number; }
export class StatusDto extends VersionDto { @IsIn(['ACTIVE', 'DISABLED']) status!: 'ACTIVE' | 'DISABLED'; }
export class CreateInvitationDto {
  @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsIn(['MEMBER', 'CHEF', 'CAMPER', 'GUEST'], { each: true }) roleCodes!: string[];
  @IsArray() @ArrayMaxSize(MODULES.length) @ValidateNested({ each: true }) @Type(() => PermissionOverrideDto) grants!: PermissionOverrideDto[];
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) maxUses?: number;
}
export class RedeemInvitationDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @TrimText() @IsString() @Matches(/^[A-Za-z0-9_-]{32}$/) code!: string;
}
export class TransferAdminDto extends VersionDto {
  @TrimText() @IsString() @Length(1, 80) targetMembershipId!: string;
  @IsInt() @Min(1) targetVersion!: number;
}
