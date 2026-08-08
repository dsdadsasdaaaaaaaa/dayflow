import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { selectionHaptic } from '../../lib/haptics';
import { normalizePhone } from '../../lib/smsCredentials';
import { useMessages } from '../../store/messages';
import { DEFAULT_SETTINGS, useSettings } from '../../store/settings';
import { taskColor, useTheme } from '../../theme';
import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';
import { Stepper } from './Stepper';

const CAPTION =
  'Alerts send when DayFlow next runs — iOS does not guarantee background ' +
  'delivery. The alert texts from your work number.';

/**
 * Settings → Safety: if a post-meeting check-in is missed, a trusted contact
 * gets an SMS from the work number (see lib/safety). Rides the messaging
 * credentials — nothing works until messaging is connected.
 */
export function SafetySection() {
  const theme = useTheme();

  const configured = useMessages((s) => s.configured);
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);

  const [nameDraft, setNameDraft] = useState(settings.trustedContactName);
  const [phoneDraft, setPhoneDraft] = useState(settings.trustedContactPhone);
  const [messageDraft, setMessageDraft] = useState(settings.safetyMessage);

  // Seed the drafts when the feature flips on/off — not on every settings echo.
  useEffect(() => {
    setNameDraft(settings.trustedContactName);
    setPhoneDraft(settings.trustedContactPhone);
    setMessageDraft(settings.safetyMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.safetyAlertEnabled]);

  const commitName = () => update({ trustedContactName: nameDraft.trim() });

  const commitPhone = () => {
    const normalized = normalizePhone(phoneDraft);
    setPhoneDraft(normalized);
    update({ trustedContactPhone: normalized });
  };

  const commitMessage = () => {
    // An empty message would make an empty SMS — fall back to the default.
    const next = messageDraft.trim() || DEFAULT_SETTINGS.safetyMessage;
    setMessageDraft(next);
    update({ safetyMessage: next });
  };

  if (!configured) {
    return (
      <SettingsSection title="Safety">
        <Text style={[styles.captionRow, { color: theme.textTertiary }]}>
          Connect messaging above first.
        </Text>
      </SettingsSection>
    );
  }

  const enabled = settings.safetyAlertEnabled;
  const missingPhone = enabled && !settings.trustedContactPhone;
  const inputStyle = [
    styles.input,
    { backgroundColor: theme.surface, color: theme.text },
  ];

  return (
    <SettingsSection title="Safety" caption={CAPTION}>
      <SettingsRow
        icon="shield-checkmark"
        tint={taskColor('amber').solid}
        label="Alert a trusted contact"
        sublabel={
          missingPhone
            ? 'Add a contact number below'
            : enabled
              ? 'If you miss a post-meeting check-in'
              : undefined
        }
        right={
          <Switch
            value={enabled}
            onValueChange={(on) => {
              selectionHaptic();
              update({ safetyAlertEnabled: on });
            }}
            trackColor={{ false: theme.surface, true: theme.accent }}
            ios_backgroundColor={theme.surface}
            accessibilityLabel="Alert a trusted contact"
          />
        }
      />
      {enabled ? (
        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: theme.textTertiary }]}>
              Contact name
            </Text>
            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              onEndEditing={commitName}
              placeholder="Sara"
              placeholderTextColor={theme.textTertiary}
              autoCorrect={false}
              style={inputStyle}
              accessibilityLabel="Trusted contact name"
            />
          </View>
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: theme.textTertiary }]}>
              Contact number
            </Text>
            <TextInput
              value={phoneDraft}
              onChangeText={setPhoneDraft}
              onEndEditing={commitPhone}
              placeholder="+1 (555) 123-4567"
              placeholderTextColor={theme.textTertiary}
              keyboardType="phone-pad"
              autoCorrect={false}
              style={inputStyle}
              accessibilityLabel="Trusted contact number"
            />
          </View>
          <View style={styles.stepperRow}>
            <View style={styles.stepperLabels}>
              <Text style={[styles.stepperLabel, { color: theme.text }]}>
                Grace period
              </Text>
              <Text style={[styles.stepperSublabel, { color: theme.textTertiary }]}>
                Extra time after the check-in before alerting
              </Text>
            </View>
            <Stepper
              value={settings.safetyGraceMinutes}
              onChange={(safetyGraceMinutes) => update({ safetyGraceMinutes })}
              min={5}
              max={60}
              step={5}
              format={(v) => `${v} min`}
            />
          </View>
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: theme.textTertiary }]}>
              Alert message
            </Text>
            <TextInput
              value={messageDraft}
              onChangeText={setMessageDraft}
              onEndEditing={commitMessage}
              placeholder={DEFAULT_SETTINGS.safetyMessage}
              placeholderTextColor={theme.textTertiary}
              multiline
              style={[...inputStyle, styles.messageInput]}
              accessibilityLabel="Safety alert message"
            />
            <Text style={[styles.fieldHint, { color: theme.textTertiary }]}>
              The meeting's location note is added to the text when there is one.
            </Text>
          </View>
        </View>
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  captionRow: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 13,
    fontWeight: '500',
  },
  form: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  field: { gap: 6 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  fieldHint: {
    fontSize: 12,
    lineHeight: 16,
  },
  input: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  messageInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepperLabels: { flex: 1, gap: 1 },
  stepperLabel: { fontSize: 15, fontWeight: '600' },
  stepperSublabel: { fontSize: 12.5, fontWeight: '500' },
});
