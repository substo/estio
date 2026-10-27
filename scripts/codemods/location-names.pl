#!/usr/bin/env perl
# Backend naming codemod: identifiers that used "brand" for a Location get
# location names. Explicit word list only; "brand" meaning the app
# (HostBrand, getClerkBrandKeys, branding, brand voice) is not touched.
#   perl -i scripts/codemods/location-names.pl <files>
use strict; use warnings;
my @map = (
  # paths
  ['lib/brands/brand-policy', 'lib/locations/location-policy'],
  ['lib/brands/brand-service', 'lib/locations/location-service'],
  ['lib/brands/substo-brands', 'lib/locations/substo-locations'],
  ['lib/brands/', 'lib/locations/'],
  ['./brand-policy', './location-policy'],
  ['./brand-service', './location-service'],
  ['./substo-brands', './substo-locations'],
  ['_components/brand-forms', '_components/location-forms'],
);
my %words = (
  BrandInvitationStatus => 'LocationInvitationStatus',
  BrandInvitationInvitedBy => 'LocationInvitationInvitedBy',
  BrandInvitationAcceptedBy => 'LocationInvitationAcceptedBy',
  BrandInvitation => 'LocationInvitation',
  brandInvitationsSent => 'locationInvitationsSent',
  brandInvitationsAccepted => 'locationInvitationsAccepted',
  brandInvitations => 'locationInvitations',
  brandInvitationId => 'locationInvitationId',
  brandInvitation => 'locationInvitation',
  brand_invite => 'location_invite',
  BrandRole => 'LocationRole',
  StudioBrandPort => 'StudioLocationPort',
  BrandDeps => 'LocationDeps',
  BrandMembership => 'LocationMembership',
  BrandActor => 'LocationActor',
  BRAND_NAME_MAX_LENGTH => 'LOCATION_NAME_MAX_LENGTH',
  defaultBrandName => 'defaultLocationName',
  normalizeBrandName => 'normalizeLocationName',
  parseBrandRole => 'parseLocationRole',
  studioRoleForBrandRole => 'studioRoleForLocationRole',
  brandRoleForLegacyStudioRole => 'locationRoleForLegacyStudioRole',
  joinBrand => 'joinLocation',
  listUserBrands => 'listUserLocations',
  createAutoBrandIfNeeded => 'createAutoLocationIfNeeded',
  ensureBrandWorkspace => 'ensureLocationWorkspace',
  getBrandRole => 'getLocationRole',
  resolveBrandWorkspaceAccess => 'resolveLocationWorkspaceAccess',
  inviteToBrand => 'inviteToLocation',
  revokeBrandInvitation => 'revokeLocationInvitation',
  revokeBrandInvitationAction => 'revokeLocationInvitationAction',
  renameBrand => 'renameLocation',
  renameBrandAction => 'renameLocationAction',
  listBrandTeam => 'listLocationTeam',
  substoBrandDeps => 'substoLocationDeps',
  getSubstoBrandActor => 'getSubstoLocationActor',
  inviteBrandMemberAction => 'inviteLocationMemberAction',
  changeBrandMemberRoleAction => 'changeLocationMemberRoleAction',
  removeBrandMemberAction => 'removeLocationMemberAction',
  BrandFormState => 'LocationFormState',
  RenameBrandForm => 'RenameLocationForm',
  openSubstoBrandStudioAction => 'openSubstoLocationStudioAction',
  memberBrands => 'memberLocations',
  BRANDS_TEST_DATABASE_URL => 'LOCATIONS_TEST_DATABASE_URL',
);
my $re = join '|', sort { length $b <=> length $a } keys %words;
while (my $line = <>) {
  for my $p (@map) { my ($a, $b) = @$p; $line =~ s/\Q$a\E/$b/g; }
  $line =~ s/\b($re)\b/$words{$1}/g;
  $line =~ s/\bactor\.brandName\b/actor.locationName/g;
  print $line;
}
