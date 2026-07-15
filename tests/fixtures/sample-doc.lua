local SampleSystem =
{
	Name = "SampleSystem",
	Type = "System",
	Namespace = "C_Sample",
	Environment = "All",

	Functions =
	{
		{
			Name = "GetThing",
			Type = "Function",
			SecretArguments = "AllowedWhenUntainted",
			Documentation = { "Returns a thing.", "Second line." },

			Arguments =
			{
				{ Name = "thingID", Type = "number", Nilable = false },
				{ Name = "filter", Type = "string", Nilable = true, Default = " \\r\\n\\t" },
			},

			Returns =
			{
				{ Name = "things", Type = "table", InnerType = "ThingInfo", Nilable = false },
				{ Name = "offset", Type = "number", Nilable = false, Default = -1 },
			},
		},
		{
			Name = "IsSecret",
			Type = "Function",
			SecretReturnsForAspect = { Enum.SecretAspect.Text },

			Returns =
			{
				{ Name = "isSecret", Type = "bool", Nilable = false },
			},
		},
	},

	Events =
	{
		{
			Name = "ThingChanged",
			Type = "Event",
			LiteralName = "THING_CHANGED",

			Payload =
			{
				{ Name = "thingID", Type = "number", Nilable = false },
			},
		},
	},

	Tables =
	{
		{
			Name = "ThingKind",
			Type = "Enumeration",
			NumValues = 2,
			MinValue = 0,
			MaxValue = 1,
			Fields =
			{
				{ Name = "Small", Type = "ThingKind", EnumValue = 0 },
				{ Name = "Large", Type = "ThingKind", EnumValue = 1 },
			},
		},
		{
			Name = "ThingInfo",
			Type = "Structure",
			Fields =
			{
				{ Name = "name", Type = "cstring", Nilable = false },
				{ Name = "kind", Type = "ThingKind", Nilable = false },
			},
		},
		{
			Name = "ThingConstants",
			Type = "Constants",
			Values =
			{
				{ Name = "MaxThings", Type = "number", Value = 250 },
				{ Name = "AllFlags", Type = "number", Value = Enum.ThingFlags.A + Enum.ThingFlags.B },
			},
		},
	},
};

APIDocumentation:AddDocumentationTable(SampleSystem);
