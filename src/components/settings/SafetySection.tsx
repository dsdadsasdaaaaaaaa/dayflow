import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { selectionHaptic, successHaptic } from '../../lib/haptics';
import { disarmSafetyEscalation, useSafetyEscalation } from '../../lib/safety';
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
  const escalation = useSafetyEscalation();

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
              // Turning the feature off must stand down a live countdown
              // immediately — otherwise an already-armed escalation would
              // still text the contact after the user revoked the feature.
              if (!on) void disarmSafetyEscalation();
            }}
            trackColor={{ false: theme.surface, true: theme.accent }}
            ios_backgroundColor={theme.surface}
            accessibilityLabel="Alert a trusted contact"
          />
        }
      />
      {escalation ? (
        <View style={styles.armedRow}>
          <Text style={[styles.armedText, { color: theme.text }]}>
            Check-in countdown armed — the alert sends at{' '}
            {dayjs(escalation.deadline).format('h:mm A')} unless you check in.
          </Text>
          <Pressable
            onPress={() => {
              successHaptic();
              void disarmSafetyEscalation();
            }}
            style={({ pressed }) => [
              styles.armedBtn,
              { backgroundColor: theme.accent, transform: [{ scale: pressed ? 0.95 : 1 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="I'm OK — cancel the safety alert"
          >
            <Text style={styles.armedBtnLabel}>I&apos;m OK</Text>
          </Pressable>
        </View>
      ) : null}
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
              {'With the standard message, the meeting’s location note is ' +
                'added to the end when there is one. In a custom message, write ' +
                '{location} where the note should go — leave it out to keep ' +
                'locations out of the alert.'}
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
  armedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  armedText: { flex: 1, fontSize: 12.5, fontWeight: '600', lineHeight: 17 },
  armedBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  armedBtnLabel: { color: '#fff', fontSize: 12.5, fontWeight: '700' },
});
